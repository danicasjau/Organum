# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend\e2e\phase7a_auth_users.spec.ts >> Phase 7A — Auth, RBAC, Capacities, Client Isolation & Admin Console >> verifies login, forced password change, /users, /me, /admin, capacities, and client boundary
- Location: frontend\e2e\phase7a_auth_users.spec.ts:93:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/entities", waiting until "load"

```

# Test source

```ts
  8   | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  9   | const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/phase7a');
  10  | 
  11  | function readPngRgba(filePath: string): { width: number; height: number; pixels: Uint8Array } {
  12  |   const buf = fs.readFileSync(filePath);
  13  |   const idatParts: Buffer[] = [];
  14  |   let width = 0;
  15  |   let height = 0;
  16  |   let colorType = 6;
  17  |   let pos = 8; // skip 8-byte PNG signature
  18  |   while (pos < buf.length) {
  19  |     const len = buf.readUInt32BE(pos);
  20  |     const chunkType = buf.toString('ascii', pos + 4, pos + 8);
  21  |     const dataStart = pos + 8;
  22  |     if (chunkType === 'IHDR') {
  23  |       width = buf.readUInt32BE(dataStart);
  24  |       height = buf.readUInt32BE(dataStart + 4);
  25  |       colorType = buf[dataStart + 9] ?? 6;
  26  |     } else if (chunkType === 'IDAT') {
  27  |       idatParts.push(buf.subarray(dataStart, dataStart + len));
  28  |     } else if (chunkType === 'IEND') {
  29  |       break;
  30  |     }
  31  |     pos = dataStart + len + 4;
  32  |   }
  33  |   const bpp = colorType === 6 ? 4 : 3;
  34  |   const raw = zlib.inflateSync(Buffer.concat(idatParts));
  35  |   const stride = width * bpp;
  36  |   const out = new Uint8Array(height * stride);
  37  |   const paeth = (a: number, b: number, c: number) => {
  38  |     const p = a + b - c;
  39  |     const pa = Math.abs(p - a);
  40  |     const pb = Math.abs(p - b);
  41  |     const pc = Math.abs(p - c);
  42  |     return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  43  |   };
  44  |   for (let y = 0; y < height; y++) {
  45  |     const filter = raw[y * (stride + 1)] ?? 0;
  46  |     const rowIn = y * (stride + 1) + 1;
  47  |     const rowOut = y * stride;
  48  |     for (let x = 0; x < stride; x++) {
  49  |       const curr = raw[rowIn + x] ?? 0;
  50  |       const a = x >= bpp ? (out[rowOut + x - bpp] ?? 0) : 0;
  51  |       const b = y > 0 ? (out[rowOut - stride + x] ?? 0) : 0;
  52  |       const c = y > 0 && x >= bpp ? (out[rowOut - stride + x - bpp] ?? 0) : 0;
  53  |       let val = curr;
  54  |       if (filter === 1) val = (curr + a) & 0xff;
  55  |       else if (filter === 2) val = (curr + b) & 0xff;
  56  |       else if (filter === 3) val = (curr + ((a + b) >> 1)) & 0xff;
  57  |       else if (filter === 4) val = (curr + paeth(a, b, c)) & 0xff;
  58  |       out[rowOut + x] = val;
  59  |     }
  60  |   }
  61  |   if (bpp === 4) return { width, height, pixels: out };
  62  |   const rgba = new Uint8Array(width * height * 4);
  63  |   for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
  64  |     rgba[j] = out[i] ?? 0;
  65  |     rgba[j + 1] = out[i + 1] ?? 0;
  66  |     rgba[j + 2] = out[i + 2] ?? 0;
  67  |     rgba[j + 3] = 255;
  68  |   }
  69  |   return { width, height, pixels: rgba };
  70  | }
  71  | 
  72  | function measureAccentPixelRatio(filePath: string): number {
  73  |   const { width, height, pixels } = readPngRgba(filePath);
  74  |   const total = width * height;
  75  |   let accentCount = 0;
  76  |   for (let i = 0; i < pixels.length; i += 4) {
  77  |     const r = (pixels[i] ?? 0) / 255;
  78  |     const g = (pixels[i + 1] ?? 0) / 255;
  79  |     const b = (pixels[i + 2] ?? 0) / 255;
  80  |     const max = Math.max(r, g, b);
  81  |     const min = Math.min(r, g, b);
  82  |     const delta = max - min;
  83  |     const sat = max === 0 ? 0 : delta / max;
  84  |     // Flag saturated violet/purple accent pixels (the primary brand accent)
  85  |     if (sat > 0.38 && b > r * 0.9 && b > g * 1.15 && max > 0.35) {
  86  |       accentCount++;
  87  |     }
  88  |   }
  89  |   return accentCount / Math.max(1, total);
  90  | }
  91  | 
  92  | test.describe('Phase 7A — Auth, RBAC, Capacities, Client Isolation & Admin Console', () => {
  93  |   test('verifies login, forced password change, /users, /me, /admin, capacities, and client boundary', async ({
  94  |     page,
  95  |   }) => {
  96  |     fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  97  |     const errors: string[] = [];
  98  |     page.on('pageerror', (err) => errors.push(err.message));
  99  |     page.on('console', (msg) => {
  100 |       // Allow intentional 404 network probe error on client boundary test
  101 |       const text = msg.text();
  102 |       if (msg.type() === 'error' && !text.includes('404')) {
  103 |         errors.push(text);
  104 |       }
  105 |     });
  106 | 
  107 |     // 1. Unauthenticated route redirects to /login; capture dark & light login
> 108 |     await page.goto('/entities');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  109 |     await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  110 |     await expect(page.getByText('Sign In — ORGANUM')).toBeVisible();
  111 |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  112 |     const loginDark = path.join(SCREENSHOTS_DIR, 'phase7a-login-dark.png');
  113 |     await page.screenshot({ path: loginDark });
  114 |     expect(measureAccentPixelRatio(loginDark)).toBeLessThan(0.1);
  115 | 
  116 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  117 |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  118 |     const loginLight = path.join(SCREENSHOTS_DIR, 'phase7a-login-light.png');
  119 |     await page.screenshot({ path: loginLight });
  120 |     expect(measureAccentPixelRatio(loginLight)).toBeLessThan(0.1);
  121 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  122 | 
  123 |     // 2. Sign in as qa_admin and check Users directory, Companies, Departments + create temp user
  124 |     await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users' });
  125 |     await expect(page.getByRole('button', { name: 'USERS', exact: true })).toBeVisible();
  126 |     await expect(page.getByRole('listbox', { name: 'Users directory' })).toBeVisible();
  127 |     await expect(page.getByText('prod_maya')).toBeVisible();
  128 |     await expect(page.getByText('cli_jordan')).toBeVisible();
  129 | 
  130 |     const usersDark = path.join(SCREENSHOTS_DIR, 'phase7a-users-dark.png');
  131 |     await page.screenshot({ path: usersDark });
  132 |     expect(measureAccentPixelRatio(usersDark)).toBeLessThan(0.1);
  133 | 
  134 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  135 |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  136 |     const usersLight = path.join(SCREENSHOTS_DIR, 'phase7a-users-light.png');
  137 |     await page.screenshot({ path: usersLight });
  138 |     expect(measureAccentPixelRatio(usersLight)).toBeLessThan(0.1);
  139 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  140 | 
  141 |     await page.getByRole('tab', { name: /Companies/ }).click();
  142 |     await expect(page.getByRole('button', { name: /Studio Internal/ })).toBeVisible();
  143 |     await expect(page.getByRole('button', { name: /Client Studio/ })).toBeVisible();
  144 |     await page.getByRole('tab', { name: /Departments/ }).click();
  145 |     await expect(page.getByRole('cell', { name: 'Lighting', exact: true })).toBeVisible();
  146 |     await page.getByRole('tab', { name: /Users \(/ }).click();
  147 | 
  148 |     // Create a temporary artist user with forced initial password change
  149 |     await page.getByRole('button', { name: '+ New User' }).click();
  150 |     const createDialog = page.getByRole('dialog');
  151 |     await createDialog.getByLabel('Username').fill('tmp_artist');
  152 |     await createDialog.getByLabel('Full Name').fill('Temp Artist');
  153 |     await createDialog.getByLabel('Temporary Password (min 10 chars)').fill('TempPass999!');
  154 |     await createDialog.getByRole('button', { name: 'Create User' }).click();
  155 |     await expect(page.getByText('Created user @tmp_artist.')).toBeVisible({ timeout: 5000 });
  156 | 
  157 |     // Log out and sign in as tmp_artist -> verify forced password change modal
  158 |     await logoutViaMenu(page);
  159 |     await page.getByLabel('Username').fill('tmp_artist');
  160 |     await page.getByLabel('Password').fill('TempPass999!');
  161 |     await page.getByRole('button', { name: 'Sign In' }).click();
  162 |     await expect(page.getByText('Password Change Required')).toBeVisible({ timeout: 10000 });
  163 |     await page.getByLabel('New Password', { exact: true }).fill('UpdatedPass999!');
  164 |     await page.getByLabel('Confirm New Password', { exact: true }).fill('UpdatedPass999!');
  165 |     await page.getByRole('button', { name: 'Set Password' }).click();
  166 |     await expect(page.getByText('Password Change Required')).toHaveCount(0, { timeout: 10000 });
  167 |     await expect(page).toHaveURL(/\/entities/);
  168 | 
  169 |     // 3. Log in as qa_admin -> test /me and /admin (Roles + Capacities + Audit Log)
  170 |     await logoutViaMenu(page);
  171 |     await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/me' });
  172 |     await expect(page.getByText('User Identity & Profile')).toBeVisible();
  173 |     await expect(page.getByText('8h / day')).toBeVisible();
  174 |     const meDark = path.join(SCREENSHOTS_DIR, 'phase7a-me-dark.png');
  175 |     await page.screenshot({ path: meDark });
  176 |     expect(measureAccentPixelRatio(meDark)).toBeLessThan(0.1);
  177 | 
  178 |     await page.goto('/admin');
  179 |     await expect(page.getByRole('table', { name: 'Role permissions matrix' })).toBeVisible();
  180 |     const adminDark = path.join(SCREENSHOTS_DIR, 'phase7a-admin-dark.png');
  181 |     await page.screenshot({ path: adminDark });
  182 |     expect(measureAccentPixelRatio(adminDark)).toBeLessThan(0.1);
  183 | 
  184 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  185 |     const adminLight = path.join(SCREENSHOTS_DIR, 'phase7a-admin-light.png');
  186 |     await page.screenshot({ path: adminLight });
  187 |     expect(measureAccentPixelRatio(adminLight)).toBeLessThan(0.1);
  188 |     await page.getByRole('button', { name: 'Toggle theme' }).click();
  189 | 
  190 |     await page.getByRole('tab', { name: 'Capacities Matrix' }).click();
  191 |     await expect(page.getByRole('table', { name: 'Capacity permissions matrix' })).toBeVisible();
  192 |     await page.getByRole('button', { name: 'Audit Log' }).click();
  193 |     await expect(page.getByText('Security & Production Audit Log')).toBeVisible();
  194 |     await expect(page.getByRole('cell', { name: 'auth.login' }).first()).toBeVisible();
  195 | 
  196 |     // 4. Sign in as dir_alex -> read-only /users, no Admin Console, SUP badge on Lighting/beauty
  197 |     await logoutViaMenu(page);
  198 |     await loginAs(page, 'dir_alex', 'DemoPass123!', { targetPath: '/entities' });
  199 |     await expect(page.getByRole('button', { name: 'USERS', exact: true })).toBeVisible();
  200 |     await page.getByRole('button', { name: 'User menu' }).click();
  201 |     await expect(page.getByRole('menuitem', { name: 'Admin Console' })).toHaveCount(0);
  202 |     await page.keyboard.press('Escape');
  203 |     await ensureHeroRobotSelected(page);
  204 |     const deptTree = page.getByRole('tree', { name: 'Entity departments and tasks' });
  205 |     const beautyRow = deptTree.getByRole('treeitem', { name: /^beauty\b/ });
  206 |     await expect(beautyRow).toContainText('SUP');
  207 | 
  208 |     // 5. Sign in as art_sam -> no USERS tab, DO badge on Modeling/main
```