-- Схема базы данных для "Графики ВИП"
-- Выполните этот файл целиком в Supabase: SQL Editor -> New query -> вставить -> Run

create extension if not exists "pgcrypto";

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  fio text not null unique,
  stop text default 'Не указано',
  created_at timestamptz default now()
);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  created_at timestamptz default now(),
  unique (employee_id, work_date)
);

-- Включаем Row Level Security и открываем доступ на чтение/запись
-- всем, у кого есть ссылка + anon-ключ проекта (подходит для закрытой
-- ссылки внутри небольшой команды; это НЕ полноценная авторизация).
alter table employees enable row level security;
alter table shifts enable row level security;

drop policy if exists "employees_all" on employees;
create policy "employees_all" on employees
  for all using (true) with check (true);

drop policy if exists "shifts_all" on shifts;
create policy "shifts_all" on shifts
  for all using (true) with check (true);
