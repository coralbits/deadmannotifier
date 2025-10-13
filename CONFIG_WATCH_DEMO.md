
# Demo: Config File Watching
# 
# Start the server with watch enabled:
#   dms serve --watch
#
# Then modify this config file and watch the server reload automatically!
# 
# Features:
# - Automatic config reload without server restart
# - Debounced updates (500ms) to prevent excessive reloads  
# - Cron service restart with new config
# - Error handling for invalid configs
# - Visual feedback with emoji status messages
#
# Example output when config changes:
# 🔄 Config file changed, reloading...
# ✅ Config reloaded successfully
# 🔄 Restarting embedded cron service...
# ✅ Embedded cron service restarted
# ✅ Server reloaded successfully

