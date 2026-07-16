#!/bin/bash
APP_URL="${APP_URL:-}"
if [[ -n "$APP_URL" ]]; then
  curl -f -s "$APP_URL/api/" >/dev/null 2>&1
  echo "$(date): Ping $APP_URL" >> /var/log/railway/app.log
fi