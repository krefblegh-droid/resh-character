# Glyph Check

A website for checking whether a font supports a Unicode character.

## Run

Requires Node.js 18+ (no dependencies).

```bash
ADMIN_PASSWORD=your-password node server.js
# open http://localhost:3000
```

- `ADMIN_PASSWORD`: the password for **Edit** and **Add form** (defaults to `changeme`, so set it).
- `PORT`: defaults to `3000`.
- `DATA_DIR`: where characters and images are saved (defaults to `./data`). On a host, point it at a persistent volume.

Data is stored in `data/db.json` and uploaded images go in `data/images/`. Back up `data/` to keep your content.

## Pages

- **Characters** (`#/characters`): every registered character as "U+2588 FULL BLOCK", each linking to its page.
- **Character U+XXXX** (`#/char/2588`): a box with a font dropdown under it. Choosing a font shows that font's image of the character. If a font has no image for this character, the box says so. **Add form** (password) uploads an image for a font.
- **Edit** (password): the Editor, with **Code** (hex, e.g. `2588`) and **Name** (Basic Latin only, auto-capitalised) fields and a **Register** button.

Uploading a form for a font that already has one replaces the old image.
