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

-- Mac link: files that came from the Mac's 3D inbox folder (path inside it)
alter table ph_files add column if not exists inbox_path text;
-- Trash: deleted files stay here 30 days (null = not in the trash)
alter table ph_files add column if not exists trashed_at bigint;
-- Where the file sits in the inbox's _trash folder once the Mac moved it
alter table ph_files add column if not exists trash_path text;

-- Jobs for the Mac link: trash (inbox -> _trash), restore (_trash -> inbox),
-- purge (_trash -> the Mac's Trash)
create table if not exists ph_link_tasks (
  id bigserial primary key,
  file_id text,
  action text not null,
  from_path text not null,
  to_path text not null default '',
  created_at bigint not null default 0,
  done boolean not null default false
);
