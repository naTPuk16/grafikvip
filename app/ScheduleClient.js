"use client";


import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtShort(d) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default function Page() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState([]); // { id, fio, stop }
  const [shiftsByEmp, setShiftsByEmp] = useState({}); // employee_id -> Set(iso dates)
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(0);

  const [fFio, setFFio] = useState("");
  const [fStop, setFStop] = useState("");
  const [fDays, setFDays] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [submitting, setSubmitting] = useState(false);
  const [busyCell, setBusyCell] = useState(null); // "empId-iso" while toggling
  const [editing, setEditing] = useState(null); // { empId, field }
  const [editValue, setEditValue] = useState("");

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  async function loadData() {
    setLoading(true);
    const { data: emps, error: e1 } = await supabase
      .from("employees")
      .select("id, fio, stop")
      .order("fio", { ascending: true });

    const from = toISO(weekDates[0]);
    const to = toISO(weekDates[6]);
    const { data: shifts, error: e2 } = await supabase
      .from("shifts")
      .select("employee_id, work_date")
      .gte("work_date", from)
      .lte("work_date", to);

    if (e1 || e2) {
      setMsg({ text: "Ошибка загрузки данных. Проверьте настройки Supabase.", type: "err" });
    }

    const map = {};
    (shifts || []).forEach((s) => {
      if (!map[s.employee_id]) map[s.employee_id] = new Set();
      map[s.employee_id].add(s.work_date);
    });

    setEmployees(emps || []);
    setShiftsByEmp(map);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function shiftWeek(delta) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
    setActiveDay(0);
  }

  function parseDays(input) {
    const dayNumbers = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));

    const matched = [];
    dayNumbers.forEach((n) => {
      const found = weekDates.find((d) => d.getDate() === n);
      if (found) matched.push(toISO(found));
    });
    return [...new Set(matched)];
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", type: "" });

    if (!fFio.trim() || !fDays.trim()) {
      setMsg({ text: "Заполните ФИО и дни", type: "err" });
      return;
    }

    const dates = parseDays(fDays);
    if (dates.length === 0) {
      setMsg({
        text: `Не удалось распознать дни. Доступные числа этой недели: ${weekDates
          .map((d) => d.getDate())
          .join(", ")}`,
        type: "err"
      });
      return;
    }

    setSubmitting(true);
    try {
      let emp = employees.find(
        (x) => x.fio.trim().toLowerCase() === fFio.trim().toLowerCase()
      );

      if (!emp) {
        const { data: inserted, error: insErr } = await supabase
          .from("employees")
          .insert({ fio: fFio.trim(), stop: fStop.trim() || "Не указано" })
          .select()
          .single();
        if (insErr) throw insErr;
        emp = inserted;
      } else if (fStop.trim()) {
        await supabase.from("employees").update({ stop: fStop.trim() }).eq("id", emp.id);
      }

      const rows = dates.map((d) => ({ employee_id: emp.id, work_date: d }));
      const { error: shiftErr } = await supabase
        .from("shifts")
        .upsert(rows, { onConflict: "employee_id,work_date" });
      if (shiftErr) throw shiftErr;

      setMsg({ text: `Добавлено: ${emp.fio} → ${dates.map((d) => d.slice(8, 10)).join(", ")}`, type: "ok" });
      setFFio("");
      setFStop("");
      setFDays("");
      await loadData();
    } catch (err) {
      setMsg({ text: "Ошибка сохранения: " + err.message, type: "err" });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleShift(empId, iso) {
    const key = empId + "-" + iso;
    setBusyCell(key);
    const set = shiftsByEmp[empId] || new Set();
    try {
      if (set.has(iso)) {
        const { error } = await supabase
          .from("shifts")
          .delete()
          .eq("employee_id", empId)
          .eq("work_date", iso);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("shifts")
          .upsert([{ employee_id: empId, work_date: iso }], { onConflict: "employee_id,work_date" });
        if (error) throw error;
      }
      await loadData();
    } catch (err) {
      setMsg({ text: "Ошибка изменения смены: " + err.message, type: "err" });
    } finally {
      setBusyCell(null);
    }
  }

  async function deleteEmployee(emp) {
    if (!window.confirm(`Удалить сотрудника «${emp.fio}» вместе со всеми его сменами?`)) return;
    try {
      const { error } = await supabase.from("employees").delete().eq("id", emp.id);
      if (error) throw error;
      await loadData();
    } catch (err) {
      setMsg({ text: "Ошибка удаления: " + err.message, type: "err" });
    }
  }

  function startEdit(emp, field) {
    setEditing({ empId: emp.id, field });
    setEditValue(field === "fio" ? emp.fio : emp.stop || "");
  }

  async function saveEdit() {
    if (!editing) return;
    const value = editValue.trim();
    const { empId, field } = editing;
    setEditing(null);
    if (!value) return;
    try {
      const { error } = await supabase.from("employees").update({ [field]: value }).eq("id", empId);
      if (error) throw error;
      await loadData();
    } catch (err) {
      setMsg({ text: "Ошибка сохранения: " + err.message, type: "err" });
    }
  }

  function cancelEdit() {
    setEditing(null);
  }

  const sortedEmployees = [...employees].sort((a, b) => a.fio.localeCompare(b.fio, "ru"));

  const activeISO = weekDates[activeDay] ? toISO(weekDates[activeDay]) : null;
  const summaryGroups = useMemo(() => {
    if (!activeISO) return {};
    const groups = {};
    employees.forEach((e) => {
      const set = shiftsByEmp[e.id];
      if (set && set.has(activeISO)) {
        const stop = e.stop || "Не указано";
        if (!groups[stop]) groups[stop] = [];
        groups[stop].push(e.fio);
      }
    });
    Object.keys(groups).forEach((k) => groups[k].sort((a, b) => a.localeCompare(b, "ru")));
    return groups;
  }, [activeISO, employees, shiftsByEmp]);

  const totalWorkingActiveDay = Object.values(summaryGroups).reduce((s, arr) => s + arr.length, 0);

  if (!supabaseConfigured) {
    return (
      <div className="wrap">
        <h1>График ВИП</h1>
        <div className="card">
          <h2>Не настроены переменные окружения</h2>
          <p style={{ fontSize: 14, color: "#444" }}>
            На сайте не заданы <code>NEXT_PUBLIC_SUPABASE_URL</code> и{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Зайдите в Vercel →
            Settings → Environment Variables, добавьте обе переменные со
            значениями из Supabase (Project Settings → API), затем откройте
            Deployments и сделайте Redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>График ВИП</h1>

      <div className="card">
        <h2>Добавить смены</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid2">
            <div>
              <label>ФИО</label>
              <input
                list="fio-list"
                value={fFio}
                onChange={(e) => setFFio(e.target.value)}
                placeholder="Иванов Иван"
              />
              <datalist id="fio-list">
                {employees.map((e) => (
                  <option value={e.fio} key={e.id} />
                ))}
              </datalist>
            </div>
            <div>
              <label>Остановка (для новых сотрудников)</label>
              <input value={fStop} onChange={(e) => setFStop(e.target.value)} placeholder="Мегаполис" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Дни через запятую (числа месяца, например 15,17,19)</label>
            <input value={fDays} onChange={(e) => setFDays(e.target.value)} placeholder="15,17,19" />
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Сохраняем..." : "Добавить в таблицу"}
            </button>
            {msg.text && <span className={"msg " + (msg.type === "err" ? "err" : "ok")}>{msg.text}</span>}
          </div>
        </form>
      </div>

      <div className="weeknav">
        <button className="secondary" onClick={() => shiftWeek(-1)}>← Пред. неделя</button>
        <span>
          {fmtShort(weekDates[0])} – {fmtShort(weekDates[6])}
        </span>
        <button className="secondary" onClick={() => shiftWeek(1)}>След. неделя →</button>
      </div>

      <div className="card scroll">
        <h2>Таблица графика</h2>
        <p style={{ fontSize: 12, color: "#888", marginTop: -4 }}>
          Кликните по ФИО или остановке, чтобы изменить. Кликните по ячейке дня, чтобы поставить или снять смену.
        </p>
        {loading ? (
          <p>Загрузка...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>ФИО</th>
                <th style={{ textAlign: "left" }}>Остановка</th>
                {weekDates.map((d) => (
                  <th key={toISO(d)}>{fmtShort(d)}</th>
                ))}
                <th>Смен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map((e) => {
                const set = shiftsByEmp[e.id] || new Set();
                const count = weekDates.filter((d) => set.has(toISO(d))).length;
                return (
                  <tr key={e.id}>
                    <td className="name" style={{ cursor: "pointer" }} onClick={() => startEdit(e, "fio")}>
                      {editing && editing.empId === e.id && editing.field === "fio" ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(ev) => setEditValue(ev.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") saveEdit();
                            if (ev.key === "Escape") cancelEdit();
                          }}
                          style={{ height: 28, padding: "0 6px" }}
                        />
                      ) : (
                        e.fio
                      )}
                    </td>
                    <td className="name" style={{ cursor: "pointer" }} onClick={() => startEdit(e, "stop")}>
                      {editing && editing.empId === e.id && editing.field === "stop" ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(ev) => setEditValue(ev.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") saveEdit();
                            if (ev.key === "Escape") cancelEdit();
                          }}
                          style={{ height: 28, padding: "0 6px" }}
                        />
                      ) : (
                        e.stop || "—"
                      )}
                    </td>
                    {weekDates.map((d) => {
                      const iso = toISO(d);
                      const on = set.has(iso);
                      const key = e.id + "-" + iso;
                      const busy = busyCell === key;
                      return (
                        <td
                          key={iso}
                          onClick={() => !busy && toggleShift(e.id, iso)}
                          style={{
                            cursor: busy ? "default" : "pointer",
                            color: on ? "#2a5ad9" : "#ccc",
                            fontWeight: on ? 600 : 400,
                            userSelect: "none"
                          }}
                          title={on ? "Кликните, чтобы снять смену" : "Кликните, чтобы поставить смену"}
                        >
                          {busy ? "…" : on ? "1" : "·"}
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 600 }}>{count}</td>
                    <td>
                      <button
                        className="secondary"
                        style={{ height: 26, padding: "0 8px", fontSize: 12 }}
                        onClick={() => deleteEmployee(e)}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sortedEmployees.length === 0 && (
                <tr>
                  <td colSpan={11}>Сотрудников пока нет — добавьте через форму выше.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>ИТОГ по дням</h2>
        <div className="tabs">
          {weekDates.map((d, i) => (
            <button
              key={toISO(d)}
              className={i === activeDay ? "active" : ""}
              onClick={() => setActiveDay(i)}
            >
              {fmtShort(d)}
            </button>
          ))}
        </div>
        {Object.keys(summaryGroups).length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>На этот день смен нет</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#666" }}>Всего: {totalWorkingActiveDay} чел.</p>
            {Object.keys(summaryGroups)
              .sort((a, b) => a.localeCompare(b, "ru"))
              .map((stop) => (
                <div className="stop-group" key={stop}>
                  <div className="stop-title">
                    {stop} ({summaryGroups[stop].length})
                  </div>
                  <div className="names">{summaryGroups[stop].join(", ")}</div>
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
