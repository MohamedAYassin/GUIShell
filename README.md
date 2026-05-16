# GUIShell: Remote Desktop Boilerplate

I built this because I wanted a clean, low-latency starting point for anyone looking to build their own remote control or screen-sharing tools. Most existing solutions are either too complex to dive into or too proprietary to modify. This is a "stripped-to-the-bones" boilerplate that gives you the essentials: real-time signaling, WebRTC streams, and remote input simulation.

Whether you're trying to build an alternative to TeamViewer, a specialized support tool, or just learning how low-level input works in Electron, this is for you.

## Why this stack?

I chose these specific technologies because they balance performance with ease of deployment:

*   **Electron:** For the cross-platform shell and native system access (keyboard/mouse control).
*   **WebRTC:** For peer-to-peer screen streaming with minimal lag.
*   **Supabase:** My go-to for handling the session database and auth. It’s fast to set up and scales perfectly.
*   **Koyeb:** Recommended for hosting the signaling server. It handles WebSockets and global routing effortlessly.

---

## How to Get Started

### 1. Configure the Signaling URL
The app needs to know where your signaling server is hosted.
- Open `electron/preload.js` and update `https://your-signaling-server.com` to your URL.
- Open `src/index.html` and update the `Content-Security-Policy` meta tag to allow connections to your domain.

### 2. Compilation (Building for Production)
This project uses `electron-builder` to package the app into a production-ready installer.

**To build for Windows:**
```bash
npm run build:win
```
The output will be in the `/dist` folder. You'll find a portable version and a standard NSIS installer.

### 3. Setting Up Auto-Updates
The boilerplate is pre-configured with `electron-updater` to handle background updates via GitHub Releases.

1.  **Repository Setup:** Ensure your `package.json` and `electron-builder.yml` point to your actual GitHub repository.
2.  **Generate a Token:** Create a GitHub Personal Access Token (classic) with `repo` permissions.
3.  **CI/CD or Local Publish:** 
    - Set an environment variable: `GH_TOKEN=your_token_here`.
    - Run the publish command:
      ```bash
      npx electron-builder --win -p always
      ```
This will build the app and automatically upload the artifacts to a "Draft" release on GitHub. Once you publish that release, users running previous versions will automatically detect and download the update on their next startup.

---

## A Note on Input Control
I'm using a fork of `nut-js` to handle the mouse and keyboard events. It’s powerful but can be finicky on different OS permissions. If you're building for production, make sure to handle the Accessibility/Screen Recording permissions on macOS particularly well.

Feel free to fork this, tear it apart, and build something better.

— Mohamed Yassin
