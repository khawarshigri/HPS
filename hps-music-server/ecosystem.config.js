// PM2 keeps the server running and restarts it if it crashes or the machine reboots.
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup      (then run the command it prints, once)
module.exports = { apps: [{ name: 'hps-music-room', script: 'server.js', cwd: __dirname, autorestart: true, max_restarts: 50, env: { PORT: 8080 } }] };
