"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "../../lib/supabaseClient";

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
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

export default function AddOnlyClient() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [fFio, setFFio] = useState("");
  const [fStop, setFStop] = useState("");
  const [fDays, setFDays] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [submitting, setSubmitting] = useState(false);
  const [knownEmployees, setKnownEmployees] = useState([]); // [{fio, stop}]

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("employees")
      .select("fio, stop")
      .order("fio", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setKnownEmployees(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFioSelect(value) {
    setFFio(value);
    const match = knownEmployees.find((e) => e.fio.toLowerCase() === value.trim().toLowerCase());
    if (match && !fStop) setFStop(match.stop || "");
  }

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  function shiftWeek(delta) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
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
      const { data: existing } = await supabase
        .from("employees")
        .select("id, fio")
        .ilike("fio", fFio.trim());

      let emp = (existing || []).find((x) => x.fio.trim().toLowerCase() === fFio.trim().toLowerCase());

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

      setMsg({
        text: `Записано: ${emp.fio} → ${dates.map((d) => d.slice(8, 10)).join(", ")}. Спасибо!`,
        type: "ok"
      });
      setFFio("");
      setFStop("");
      setFDays("");
    } catch (err) {
      setMsg({ text: "Ошибка сохранения: " + err.message, type: "err" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="wrap">
        <h1>Заполнение графика</h1>
        <div className="card">
          <p>Форма временно недоступна. Свяжитесь с администратором.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Заполнение графика</h1>

      <div className="weeknav">
        <button className="secondary" onClick={() => shiftWeek(-1)}>← Пред. неделя</button>
        <span>
          {fmtShort(weekDates[0])} – {fmtShort(weekDates[6])}
        </span>
        <button className="secondary" onClick={() => shiftWeek(1)}>След. неделя →</button>
      </div>

      <div className="card">
        <h2>Укажите свои смены</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid2">
            <div>
              <label>ФИО</label>
              <input
                list="known-fio"
                value={fFio}
                onChange={(e) => handleFioSelect(e.target.value)}
                placeholder="Иванов Иван"
              />
              <datalist id="known-fio">
                {knownEmployees.map((e) => (
                  <option value={e.fio} key={e.fio} />
                ))}
              </datalist>
            </div>
            <div>
              <label>Остановка</label>
              <input value={fStop} onChange={(e) => setFStop(e.target.value)} placeholder="Мегаполис" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>
              Дни через запятую, числа месяца (неделя {fmtShort(weekDates[0])}–{fmtShort(weekDates[6])})
            </label>
            <input value={fDays} onChange={(e) => setFDays(e.target.value)} placeholder="15,17,19" />
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Сохраняем..." : "Отправить"}
            </button>
            {msg.text && <span className={"msg " + (msg.type === "err" ? "err" : "ok")}>{msg.text}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
