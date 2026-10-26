#!/bin/sh
node bot.js &
node web.js &
wait -n
exit $?
