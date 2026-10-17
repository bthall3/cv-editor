# CV Editor

A browser-based CV editor with a live preview and Word (.docx) export (US Letter, 1" margins, Times New Roman 11pt,
ruled bold headings, hanging-indent citations, borderless date tables).

This site is a **blank template and contains no personal data.** Your CV is stored in *your own private GitHub repo*,
which the editor reads and writes with an access token only you have. Other visitors can use the editor, but their edits stay
in their own browser and cannot reach your data.

## Use

1. Open the site (or `index.html` locally; no build, no server).
2. **Connect your private repo** (one time per browser), see below. Your CV loads, and every edit is committed back ~4 seconds after you stop typing.
3. Edit sections (add / delete / reorder entries, add or hide sections). Publications use structured fields (authors, year, title,
   journal, status) and are formatted APA style with your name bolded and the journal italicized; changing an entry's *Status*
   moves it between "Publications" and "Manuscripts in Progress".
4. **Export .docx** downloads the Word file.

## Connect your private repo

1. Create a **private** GitHub repo for your data (tick "Add a README file" so it has a default branch).
2. GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   Repository access: *Only select repositories* > your data repo. Permissions: *Contents: Read and write*. Choose an expiration you will remember to renew.
3. In the editor open **GitHub backup**, enter `yourname/your-repo` and the token, and click **Connect & sync**.
   The `cv-data` branch and `cv-data.json` are created for you; the commit history is your version history.
4. After clearing cookies/site data the editor shows the blank template again. Re-enter the repo and token and choose
   **OK = load the GitHub copy**.

The token is stored in this browser only. Treat it like a password, use it only on your own devices, and click **Disconnect** on a shared computer.

## Other backups
- **Link backup file** (Chrome/Edge): auto-saves to a file on your disk.
- **Save backup (.json)** / **Load backup**: manual, works everywhere.
- The toolbar badge turns amber when edits exist only in this browser, and the browser warns before you close the tab.

## Code
- `format.js`: turns data into format-neutral blocks (shared by the preview and the export so they match)
- `export-docx.js`: blocks to .docx using the vendored [`docx`](https://github.com/dolanmiu/docx) 9.0.3 (MIT, `vendor/`)
- `app.js`, `style.css`, `index.html`: editor and preview; `data/seed.js`: the blank template
