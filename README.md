# Intern Attendance Portal

A lightweight attendance portal for manager-controlled intern attendance with persistent database storage.

## Features

- Single manager login for roster and attendance management
- Add interns with name and department
- Mark attendance by `Morning` and `Evening` session
- Auto-select `Morning` or `Evening` for today's attendance based on local time
- Select any attendance date to view or update previous-day records
- Undo the last removed intern with `Ctrl + Z`
- Reset attendance for a new day
- Save attendance data in a local SQLite database
- Export attendance CSV
- View `Daily`, `Weekly`, `Monthly`, and `Date to date` attendance reports
- Combine morning and evening attendance into a daily final result for reports
- Calculate `Half Day` when one session is attended and the other is not
- View intern-wise detailed report rows with:
  - `Name`
  - `Department`
  - `Date`
  - `Morning`
  - `Evening`
  - `Final Status`
- Filter detailed reports by status, name, and department
- Sort detailed reports and export filtered detailed CSV

## Run

1. Install dependencies with `npm.cmd install`
2. Start the server with `npm.cmd start`
3. Open `http://localhost:4000`

## Default credentials

- Admin username: `admin`
- Admin password: `admin123`

## Files

- `index.html` - portal layout
- `styles.css` - responsive styling
- `app.js` - frontend logic, login flow, and manager dashboard
- `server.js` - Express API and SQLite persistence
- `data/attendance.db` - generated database file

## Reporting rules

- `Present + Present` => `Present`
- `Late + Late` => `Late`
- `Leave + Leave` => `Leave`
- `Present + Absent` => `Half Day`
- `Absent + Present` => `Half Day`
- Mixed `Present/Late/Leave` combinations that split the day can also count as `Half Day`

## Deployment note

After updating code, restart `node server.js`.

Hard refresh the browser with `Ctrl + F5` so the latest frontend script loads.

## Render deploy

- Create a `Web Service` on Render
- Connect this GitHub repo
- Render can use `render.yaml` automatically
- On Render free, the app stores SQLite data at `/tmp/inter_attendance_data/attendance.db`
- This path is writable, but it is temporary and can be cleared on restart/redeploy

### Render settings

- Build Command: `npm install`
- Start Command: `npm start`
- Runtime: `Node`

### Required environment variables

- `GMAIL_SENDER`
- `GMAIL_APP_PASSWORD`
- `PASSWORD_CODE_EMAIL`

### Important

- On Render free, SQLite data is not permanent.
- If you want data to survive redeploys and restarts reliably, use a paid plan with a persistent disk or move to Postgres.
