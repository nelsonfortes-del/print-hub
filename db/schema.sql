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

-- Preview picture for each file (made in the browser, a few dozen KB)
alter table ph_files add column if not exists thumb bytea;
alter table ph_files add column if not exists thumb_type text;
alter table ph_files add column if not exists thumb_v bigint not null default 0;

-- Where a file came from on the computer it was uploaded from ("labels/hits/x.stl")
alter table ph_files add column if not exists source_path text;

-- Files deleted in Print Hub, so the Mac cleanup script can trash the
-- originals too. "cleaned" = handled on the Mac (or kept on purpose).
create table if not exists ph_removed (
  id text primary key,
  name text not null default '',
  ext text not null default '',
  size bigint not null default 0,
  source_path text,
  removed_at bigint not null default 0,
  cleaned boolean not null default false
);

-- Folders inside a project (B: Honeycomb Wall -> Tiles, Trays, Clips)
alter table ph_projects add column if not exists folders jsonb not null default '[]';
alter table ph_files add column if not exists subfolder text;

-- Sellable shelf: clean, tested prints worth selling, with an asking price
alter table ph_files add column if not exists sellable boolean not null default false;
alter table ph_files add column if not exists price numeric(8,2);

-- The file's own date from the computer it came from (last saved), ms since 1970
alter table ph_files add column if not exists modified bigint;

-- Status of a print file: raw (as downloaded / made), cleaned (fixed up),
-- final (printed well). Guessed once from the name for older files.
alter table ph_files add column if not exists stage text;
update ph_files set stage = case when name ~* 'final' then 'final' when name ~* 'clean' then 'cleaned' else 'raw' end where stage is null;

-- Sets: multi-piece prints (e.g. crown top + crown base) shown as one card.
-- A file belongs to at most one set (ph_files.set_id).
create table if not exists ph_sets (
  id text primary key,
  name text not null default '',
  fav boolean not null default false,
  stage text not null default 'raw',
  project_id text,
  category text not null default 'Personal',
  added bigint not null default 0
);
alter table ph_files add column if not exists set_id text;

-- Hub-only extras: a display title over the file name, and notes. Sets get
-- tags and notes too.
alter table ph_files add column if not exists title text not null default '';
alter table ph_files add column if not exists notes text not null default '';
alter table ph_sets add column if not exists tags jsonb not null default '[]';
alter table ph_sets add column if not exists notes text not null default '';
