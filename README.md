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
  `Name`, `Department`, `Date`, `Morning`, `Evening`, `Final Status`
- Filter detailed reports by status, name, and department
- Sort detailed reports and export filtered detailed CSV

## Run

1. Install dependencies with `npm.cmd install`
2. Optional: copy `.env.example` to `.env` and fill in your Gmail settings for password reset
3. Start the server with `npm.cmd start`
4. Open `http://localhost:4000`

## Default credentials

- Admin username: `admin`
- Admin password: `admin123`

## Files

- `frontend/index.html` - portal layout
- `frontend/styles.css` - responsive styling
- `frontend/app.js` - frontend logic, login flow, and manager dashboard
- `backend/server.js` - Express API and SQLite persistence
- `backend/start-server.bat` - Windows helper to start the app
- `data/attendance.db` - generated database file

## Reporting rules

- `Present + Present` => `Present`
- `Late + Late` => `Late`
- `Leave + Leave` => `Leave`
- `Present + Absent` => `Half Day`
- `Absent + Present` => `Half Day`
- Mixed `Present/Late/Leave` combinations that split the day can also count as `Half Day`

## Deployment note

- After updating code, restart `node backend/server.js`
- Hard refresh the browser with `Ctrl + F5` so the latest frontend script loads

## Local email setup

Create a `.env` file in the project root with:

`DATABASE_URL=your_supabase_postgres_connection_string`
`GMAIL_SENDER=networkcorvitpwr@gmail.com`
`GMAIL_APP_PASSWORD=your_google_app_password`
`PASSWORD_CODE_EMAIL=networkcorvitpwr@gmail.com`

Notes:
- Leave `DATABASE_URL` empty for local SQLite mode
- Set `DATABASE_URL` in production to use Supabase/Postgres instead of SQLite
- `GMAIL_APP_PASSWORD` must be a Google App Password, not your normal Gmail password
- `.env` is ignored by git and stays local on your machine

## Vercel production setup

Set these environment variables in Vercel:

- `DATABASE_URL` = your Supabase Postgres connection string
- `GMAIL_SENDER` = your Gmail sender address
- `GMAIL_APP_PASSWORD` = your Google App Password
- `PASSWORD_CODE_EMAIL` = email address that receives reset codes

Production notes:
- Local SQLite is kept for local development
- Vercel should use `DATABASE_URL` so attendance, users, sessions, and reset codes are persistent
- Frontend source lives in `frontend/` and is synced to `public/` during build for Vercel
