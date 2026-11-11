# Print Hub

A personal catalog for 3D-print files. Drag STL, 3MF, OBJ, STEP or G-code files
in, file them under **Work** or **Personal** and a project, tag and favorite
them, and log every print (printer, material, temperatures, supports, success or
fail). Printers and Materials are editable lists under Settings; picking a
material when logging a print fills in its temperatures.

**Projects** each have a status (Idea → In design → Ready to print → In
progress → Works / Done, or Stalled) and notes. If more than one Work project is
In progress, the Projects page reminds you to finish one first.

**Status:** every file is **Raw**, **Cleaned** or **Final**. New files are
guessed from the name ("final" in it = Final, "clean" = Cleaned, else Raw);
older files were guessed once the same way. **Mark Final** in a file's panel is
one tap after a good print; Final files get a green badge and their own
**Final** entry in the sidebar. Select mode has **Set status…** for many files.
Stored as `ph_files.stage`.

**Sets** (multi-piece prints): in Select mode, pick 2+ files and press **Make
set**; it's named from what the pieces' names share, and you can rename it. A
set shows as one card in the list (its pieces don't show on their own unless
**Show set pieces** is on). Open it to rename, star, set its status and project
(the pieces follow the project), take pieces out, or **Ungroup** (nothing is
deleted). **Add to set…** in Select mode adds files to an existing set. Stored
in `ph_sets` and `ph_files.set_id`.

**Sellable:** a gold shelf in the sidebar for prints that are clean, tested and
worth selling. Open a file and press **+ Sellable**, then type an asking price;
the price shows on the file's card. Stored as `ph_files.sellable` and
`ph_files.price`.

**Auto-sort:** each project has a few auto-sort words. When you add files
(anywhere except inside a project), each file goes to the project whose word
starts a word in the file name, e.g. `CageHook_v2.stl` → Metris Van Cage
Hooks. If several match, the longest word wins. Files that match nothing go to
**Unsorted**. Adding files while viewing a project puts them all in that
project. The matching code is `src/autosort.js`.

**Folders and zips:** drag a folder or a `.zip` in (or use **Add folder**) and
every 3D file inside is added, including subfolders. The top folder's name
becomes a tag, and folder names help auto-sort when a file's own name doesn't
match. Files already in the library (same name and size) are skipped, and so
are non-3D files and Mac junk like `.DS_Store`. See `src/collect.js`.

**Preview pictures:** every file gets a picture, made in the browser
(`src/thumbs.js`). 3MF files from a slicer and G-code from Orca-based slicers
(Anycubic Slicer Next, Bambu Studio, OrcaSlicer) already contain a preview,
which is used as-is. Otherwise the model is drawn in 3D with three.js (STL, OBJ,
3MF, G-code). STEP files get no picture. Pictures are stored in the database
(`ph_files.thumb`) and files added before this feature get theirs filled in
automatically the next time the page is open. If a preview can't be made, the
file panel says why and has a **Try again** button.

**Folders inside a project:** open a project to see its folder buttons (All,
each folder, Not in a folder, + New folder, Edit folders). Each file's panel has
a Folder picker, and Select mode can move many files into a folder. Files added
while a folder is open go into it; when you drop a folder from your Mac, files
inside a subfolder with the same name as a project folder (e.g. `Tiles/`) go
into that folder.

**File dates:** each file keeps its own date from your Mac (when it was last
saved), shown on its card. Sort with the menu above the files: Newest first,
Oldest first, Name, or Recently added. Files added before dates were kept show
their added date; drag them in again to fill in the real one. Files from inside
a `.zip` don't carry a date. Stored as `ph_files.modified`.

**Select mode:** press **Select**, tap files (or **Select all**), then **Move to
project…**, **Move to folder…** (inside a project), **★ Favorite**, **$ Sellable**
or **Delete**. Favorite and Sellable turn the mark on for all picked files, or
off if they all have it already.

**Duplicates** (Settings): **Scan for duplicates** compares every stored file
that shares a type and size with another, byte for byte, so it finds exact
copies even under different names. In each group one copy is kept (the one in
a project, with print logs, Sellable or Favorite, else the oldest); tap a card
to keep a different one. Deleting duplicates does not add them to the Mac
cleanup list, because the kept copy has the same name and size and the
cleanup script would trash it too. Code: `src/DuplicatesPage.jsx`.

**Deleting and Mac cleanup:** delete one file from its panel, or use **Select**
to pick many and delete them together. Deleted files go on the **Mac cleanup**
list (Settings), with the folder they came from. The page makes a script
(`src/cleanup.js`) you run in Terminal with `bash`: it finds files in your home
folder with the exact same name and size, lists them, asks, and moves them to
the Trash (Put Back still works). Then press **Mark all as done**. The starting
printers, filament and projects come from Nelson's 3D printing notes and are
loaded once; after that, everything is edited in the app. Easiest: the Mac cleanup page shows one command to paste in Terminal,
`bash <(curl -fsSL <site>/api/cleanup-script)`, which runs the same script straight
from the site (no download).

## Where things are stored

- **The catalog** (files, tags, print logs, printers, materials) is in a Postgres
  database (Neon). The tables are created automatically the first time the app
  runs (`db/schema.sql`).
- **The 3D files themselves** are in Vercel Blob, up to 500 MB each. Uploads go
  straight from the browser to Blob storage. Either kind of Blob connection works: a
  `BLOB_READ_WRITE_TOKEN`, or the newer `BLOB_STORE_ID` (signs in with the
  project's Vercel identity, uploads use presigned addresses).
- There's no PIN or login: anyone with the address can open it.

## Setting it up on Vercel

1. Import this repository as a new Vercel project (framework: Vite).
2. In the project's **Storage** tab, create a **Neon** database and connect it.
   That sets `DATABASE_URL`.
3. In the same tab, create a **Blob** store (private) and connect it. That sets
   `BLOB_READ_WRITE_TOKEN`.
4. Redeploy.

## Running it on your own computer

```bash
npm install
echo "DATABASE_URL=postgres://..." > .env   # any Postgres database
npm run dev                                 # http://localhost:5180
```

Without a Blob token, files are saved in `db/.local-files/` instead.

## Code

| Path | What it is |
|---|---|
| `src/PrintHub.jsx` | The whole screen: catalog, file panel, print log, printers, materials |
| `src/printhub.css` | All the styling |
| `src/store.js` | Talks to the server and uploads files |
| `api/[resource].js` | The server routes (`/api/state`, `/api/files`, …) |
| `api/_lib/printhub.js` | Database and file-storage code |
| `dev-server.js` | Runs the server routes locally for `npm run dev` |
