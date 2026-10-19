# HPS Music Room server

A single Node.js server (no npm packages needed) that provides:

- **Student accounts**: students sign up in the app with a class code, or log in.
- **Progress sync**: the app sends each student's stars and scores to the server every few seconds.
- **Teacher / admin dashboard** at `/admin`.
- **The web version of the app** at `/` (from the `public/` folder).

## Run it

```bash
node server.js            # http://localhost:8080  ·  dashboard: http://localhost:8080/admin
PORT=3000 node server.js  # choose another port
DATA_DIR=/var/hps node server.js   # where db.json is stored (default ./data)
```

Node 18 or newer. All data is kept in `data/db.json`. Back this file up.

## Demo accounts (created on first run)

| Role | Username | Password |
|---|---|---|
| Super admin | `admin` | `Admin@123` |
| Teacher | `teacher1` | `Teacher@123` |
| Student | `student1` | `Student@123` |

Demo class: **Grade 2 · Music**, class code **HPS2MU** (taught by teacher1).
Change these passwords before real use (dashboard → reset password). Delete `data/db.json` to start fresh with the demo accounts.

## Who can do what

- **Super admin**: adds, renames and removes teachers; creates classes for any teacher; sees every class and student; resets any password; deletes students.
- **Teacher**: creates classes (each gets a 6-letter code), adds students (from the Students page or a class), removes them from a class or deletes their account, resets their students' passwords, sees every student's progress, downloads a class CSV.
- **Student**: signs up in the app with a class code, or logs in. Progress is saved to their account, so they can log in on any tablet.

## Connecting the app

- **Web version** served by this server: works automatically.
- **Android app / Windows app**: on the sign-up screen tap **School server** and type the address, e.g. `http://192.168.1.20:8080` (school Wi-Fi) or `https://music.yourschool.pk` (hosted). It is remembered on that device.
- To build the app with the address already filled in: `HPS_API=https://music.yourschool.pk python3 make_offline.py`, then rebuild the APK.

## Keep it running all the time

Pick one. All of them restart the server automatically if it stops.

**A. A PC at school (Windows), simplest**
1. Install Node.js (LTS) from https://nodejs.org on a PC that stays on.
2. Right-click `install-autostart-windows.bat` and choose **Run as administrator**.
3. It starts the server now and every time the PC boots, opens port 8080 in the firewall, and prints the address tablets should use (e.g. `http://192.168.1.20:8080`).
4. Give that PC a fixed IP in the Wi-Fi router so the address never changes. To undo, run `uninstall-autostart-windows.bat`.

**B. A Linux server or VPS (best for use from home too)**
Copy the folder to `/opt/hps-music-server`, then:
`sudo cp hps-music.service /etc/systemd/system/ && sudo systemctl enable --now hps-music`
Put it behind a domain with HTTPS (e.g. Nginx or Caddy) such as `https://music.hps.edu.pk`.

**C. PM2 (Windows, Mac or Linux)**
`npm install -g pm2`, then `pm2 start ecosystem.config.js`, `pm2 save`, `pm2 startup`.

**D. Docker / cloud**
`docker build -t hps-music . && docker run -d --restart=always -p 8080:8080 -v hps-data:/data hps-music`
For Render.com, `render.yaml` is included (needs the paid starter plan: free plans sleep and lose the data file).

Back up `data/db.json` regularly: it holds every account and score.

Once you have the permanent address, build the app with it filled in so students never have to type it:
`HPS_API=https://music.hps.edu.pk python3 make_offline.py` and rebuild the APK (or send the address to Claude to do it).

## API (JSON)

`POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/me` · `GET|PUT /api/progress` ·
`GET /api/overview` · `GET|POST /api/classes` · `PATCH|DELETE /api/classes/:id` ·
`GET|POST /api/classes/:id/students` · `DELETE /api/classes/:id/students/:sid` ·
`GET|POST /api/teachers` · `PATCH|DELETE /api/teachers/:id` · `POST /api/users/:id/password`
