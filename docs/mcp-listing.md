# Bryt Shell: text for MCP directories and posts

Copy and paste as needed. Everything below is true of the current release.

**Name:** Bryt Shell (`bryt-shell`)

**One line:** A tabbed PowerShell terminal for Windows that AI apps can use through MCP, in tabs you can watch, with approvals and a Stop button.

**Short description:** Bryt Shell is a free, local-first Windows terminal. Connect Claude Desktop, Claude Code, Cursor or VS Code in one click and an AI can open tabs, run PowerShell, create projects from templates, start servers in the background and read or write files. You see every command in a visible tab marked AI; risky actions ask you first, folders can be trusted once, a red Stop AI button interrupts everything, and every action is written to an audit log. No account, no telemetry, no network connections.

**Transport:** stdio (the app's bundled bridge talks to the running app over a local named pipe with a secret token). Nothing is exposed to the network.

**Install:** download `Bryt-Shell-Setup.exe` from https://github.com/muhumuza684/bryt-shell/releases/latest, open **Settings, AI access** (or click the AI chip), and press **Connect** next to your AI app.

**Tools (19):** `list_tabs`, `create_tab`, `rename_tab`, `close_tab`, `run_in_tab` (with `background` and `readyText`), `send_to_tab`, `read_tab_output`, `run_command`, `create_project`, `list_directory`, `read_file`, `write_file`, `export_project`, `import_project`, `web_fetch`, `open_url`, `delete_path`, `recycle_bin`, `apps`.

**Safety model:** off by default; local pipe plus token; approvals shown as an in-app banner; risky commands and anything touching keys or credentials always ask; trusted folders; per-area Access switches (Off, On, Admin only); Stop AI; audit log. It is a speed bump, not a sandbox: connect only AI apps you trust.

**Platform:** Windows 10 and 11. **License and source:** https://github.com/muhumuza684/bryt-shell

**Config for apps that are not auto-detected** (Settings, AI access, "Copy settings (JSON)" prints the exact values for your PC):

```json
{ "mcpServers": { "bryt-shell": { "command": "<Bryt Shell.exe>", "args": ["<path to mcp/bryt-shell-mcp.js>"], "env": { "ELECTRON_RUN_AS_NODE": "1", "BRYT_AI_PIPE": "...", "BRYT_AI_TOKEN_FILE": "..." } } } }
```

**A 30-second demo script (for a screen recording):**
1. Click the AI chip, turn it on, press Connect next to VS Code.
2. In VS Code chat (Agent mode): "In Bryt Shell, create a web project called my-first-site, make a nice one-page site for BrytMa Tech Uganda, and open it in my browser."
3. Show the AI tab, the files and the page. Then press Stop AI.
