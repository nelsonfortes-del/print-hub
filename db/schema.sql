-- Print Hub database tables. Created automatically the first time the app runs.
-- The 3D files themselves live in Vercel Blob; ph_files.blob_path points at
-- each one. A file's print log is a small JSON list on its row (newest first).
create table if not exists ph_files (
  id text primary key,
  name text not null default '',
  ext text not null default 'stl',
  size bigint not null default 0,
  category text not null default 'Functional parts',
  tags jsonb not null default '[]',
  fav boolean not null default false,
  added bigint not null default 0,
  prints jsonb not null default '[]',
  blob_path text,
  updated_at timestamptz not null default now()
);

create table if not exists ph_printers (
  id text primary key,
  name text not null default '',
  nozzle text not null default '0.4',
  volume text not null default '',
  notes text not null default '',
  sort double precision not null default 0
);

create table if not exists ph_materials (
  id text primary key,
  name text not null default '',
  nozzle integer,
  bed integer,
  fan integer,
  notes text not null default '',
  sort double precision not null default 0
);

create table if not exists ph_meta (
  key text primary key,
  value text not null default ''
);

create index if not exists idx_ph_files_added on ph_files(added desc);

-- Projects (Work or Personal). Each file can belong to one.
create table if not exists ph_projects (
  id text primary key,
  name text not null default '',
  category text not null default 'Personal',
  status text not null default 'Idea',
  notes text not null default '',
  sort double precision not null default 0
);

alter table ph_files add column if not exists project_id text;

-- Words that auto-sort uploaded files into a project (comma-separated)
alter table ph_projects add column if not exists keywords text not null default '';
