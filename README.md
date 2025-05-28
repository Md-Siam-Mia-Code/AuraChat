<p align="center">
<img src="assets/Banner.png" alt="Aura Chat Banner">
  <h1 align="center">✨ Aura Chat 🔮</h1>
</p>

<p align="center">
  <strong>Connect, Converse, Captivate! Aura Chat bathes your real-time communication in a mesmerizing purple and pink gradient, offering a secure and delightful chatting experience.</strong> 🌌💬
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare" alt="Cloudflare D1">
  <img src="https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript" alt="JavaScript ES6+">
  <img src="https://img.shields.io/badge/WebSockets-Realtime-blue" alt="WebSockets">
  <!-- Add other relevant badges if you like! -->
</p>

<br/>
<p align="center">
  <!-- Add a screenshot of Aura Chat UI here! -->
  <!-- Example: <img src="assets/aura_chat_ui.png" alt="Aura Chat UI Screenshot" width="700"> -->
  <em>(Imagine a beautiful screenshot of Aura Chat's vibrant UI here! 🤩)</em>
</p>

---

## 🚀 What is Aura Chat? 🤔

Aura Chat is your personal, self-hostable real-time messaging sanctuary, built to run blazing fast on Cloudflare Workers! ⚡️ It's designed for secure 1-on-1 conversations, wrapped in an enchanting purple and pink "Aura" theme that's both modern and easy on the eyes. With robust user authentication 🔑, a comprehensive admin dashboard 📊, and all the essential chat features, Aura Chat makes connecting with others a truly magical experience.

The UI is intuitive, adapting beautifully to light and dark modes 🌓, and is fully responsive for a seamless experience across all your devices 💻📱.

---

## ✨ Key Features 🌟

*   **⚡️ Blazing Fast Real-time Messaging:** Instant message delivery powered by WebSockets on the Cloudflare edge. Feel the speed! 💨
*   **💬 Secure 1-on-1 Chats:** Connect privately with other users. Your conversations, your space. 🤫
*   **🎨 Vibrant "Aura" UI:** A stunning interface with purple and pink gradients that make chatting a visual delight. It's not just chat, it's an *aura*! 💜💖
*   **🌓 Adaptive Light/Dark Mode:** Switches themes based on your system preference or with a manual toggle. Perfect for day ☀️ or night 🌙.
*   **📱 Fully Responsive Design:** Looks and works great on desktops, tablets, and mobile phones. Includes a sleek slide-out panel for conversations on mobile! ➡️
*   **🔐 Robust Authentication:** Secure user login and session management with JWTs. Your identity is safe! 🛡️
*   **👑 Admin Aura Panel:** For the all-seeing administrator! 💪
    *   Monitor system statistics (total users, messages, active users, conversations). 📈
    *   Manage user accounts (add new users, delete existing ones). 🧑‍💼
    *   Exclusive admin login via a secure Master Password. 🗝️
*   **🟢 Online Presence Indicators:** Instantly see who's online and available to chat! ✅
*   **✍️ Typing Indicators (via WebSocket polling):** Know when your chat partner is typing a reply. The suspense! 👀
*   **🚫 User Blocking:** Maintain your peace by easily blocking and managing users. Serenity now! 🧘
*   **✏️ Message Editing:** Made a typo? No problem! Edit your sent messages. ✨
*   **↩️ Message Replying:** Context is key! Reply directly to specific messages. 🗣️
*   **🗑️ Message Deletion:** Sent something you regret? Users can delete their own messages. Poof! 💨
    *   *Emoji-only messages are now fully featured too!* 😉
*   **⏳ Older Message Loading:** Scroll up to automatically load older messages, or use the handy "Load Older Messages" button. Never miss a part of the conversation! 📜
*   **⚙️ Easy Initial Admin Setup:** A simple onboarding process to create the first administrator and get your Aura Chat instance live in minutes! ⏱️

---

## 🛠️ Tech Stack & Dependencies 🧱

*   **Frontend:**
    *   HTML5
    *   CSS3 (with CSS Variables for theming) 💅
    *   Vanilla JavaScript (ES6+) 🍦 (No heavy frameworks, pure speed!)
    *   [Font Awesome](https://fontawesome.com/) (For those slick icons) <i class="fa-solid fa-icons"></i>
    *   [Google Fonts (Poppins & Inter)](https://fonts.google.com/) 🅰️
*   **Backend & Platform:**
    *   **Cloudflare Workers:** Serverless functions for the backend logic. 엣지 컴퓨팅! 🚀
    *   **Cloudflare D1:** SQL database for persistent storage. 💾
    *   **Cloudflare KV Storage:** (Optional, based on your `wrangler.jsonc` - can be used for session data or other key-value needs). 🔑
    *   **WebSockets:** For real-time bi-directional communication. 🕸️
    *   **JOSE Library:** For JWT handling (signing and verification). 🛡️
*   **Tooling:**
    *   **Wrangler CLI:** For development, deployment, and management of Cloudflare resources. 🤠
    *   Node.js & npm (Primarily for using Wrangler). 📦

---

## ⚙️ Getting Started & Setup Wizardry! 🧙‍♂️

Ready to unleash the Aura? Follow these mystical steps:

### Prerequisites 📜

*   **Cloudflare Account:** You'll need one to use Workers, D1, and KV. Sign up at [cloudflare.com](https://www.cloudflare.com). ✅
*   **Node.js & npm:** Required to use the Wrangler CLI. Download from [nodejs.org](https://nodejs.org/). (LTS version recommended). ✅
*   **Wrangler CLI:** Install or update it globally: `npm install -g wrangler`. ✅

### Installation & Configuration Magic ✨

1.  **Clone the Mystical Scrolls (Repository):** 📜
    ```bash
    git clone https://github.com/Md-Siam-Mia-Code/AuraChat.git
    cd AuraChat
    ```

2.  **Consult the Ancient Commands (`commands.txt`):** 📜
    This project includes a `commands.txt` file. It's your spellbook! 📖 Many necessary `wrangler` commands for database creation, schema migration, and other tasks are listed there for your convenience. **Refer to it often!**

3.  **Summon Your D1 Database:** 🪄
    Use Wrangler to create your D1 database. A command similar to this will be in `commands.txt`:
    ```bash
    # Example command (check commands.txt for the exact one for this project)
    npx wrangler d1 create aurachat-db
    ```
    After creation, Wrangler will output your database's `database_id`.

4.  **Enchant `wrangler.jsonc`:** 🔮
    Open `wrangler.jsonc` in your editor.
    *   Locate the `d1_databases` section. Update the `database_id` for the `DB` binding with the ID you received in the previous step.
      ```jsonc
      // Example snippet from wrangler.jsonc
      "d1_databases": [
          {
              "binding": "DB",
              "database_name": "aurachat-db", // Or your chosen name
              "database_id": "YOUR_NEW_DATABASE_ID_HERE" // 👈 Update this!
          }
      ],
      ```
    *   If you plan to use Cloudflare KV (as hinted in your `wrangler.jsonc`), create a KV namespace using Wrangler:
      ```bash
      # Example command (check commands.txt)
      npx wrangler kv:namespace create aurachat-kv
      ```
      Then, update the `id` in the `kv_namespaces` section of `wrangler.jsonc` with the ID provided by Wrangler.
      ```jsonc
       "kv_namespaces": [
        {
          "binding": "aurachat-kv", // Your binding name
          "id": "YOUR_NEW_KV_NAMESPACE_ID_HERE" // 👈 Update this!
        }
      ],
      ```

5.  **Apply the Database Schema:** ✨
    Use Wrangler to apply the `schema.sql` to your newly created D1 database. The command will be in `commands.txt`:
    ```bash
    # Example command (check commands.txt)
    npx wrangler d1 execute aurachat-db --file ./schema.sql --remote
    ```

6.  **Secure Your Secrets (`.dev.vars`):** 🤫
    Create a file named `.dev.vars` in the root of your project (this file should be in `.gitignore` and **NEVER** committed to Git).
    Add your `JWT_SECRET`. This secret *must* be at least 32 characters long for security.
    ```ini
    # .dev.vars
    JWT_SECRET="your-super-secret-and-long-jwt-key-that-is-at-least-32-characters"
    # FRONTEND_ORIGIN="https://your-deployed-frontend-url.com" # Optional: for CORS in production
    ```
    For local development, Wrangler uses `.dev.vars`. For production, you'll set secrets using `npx wrangler secret put JWT_SECRET`.

7.  **Ignite the Local Development Server:** 🔥
    ```bash
    npx wrangler dev --assets ./public
    ```
    This will start a local server, typically on `http://localhost:8787`.

8.  **Deploy to the Cloudflare Edge:** ☁️🚀
    When you're ready to go live:
    ```bash
    npx wrangler deploy --assets ./public
    ```
    Remember to set your `JWT_SECRET` in the deployed Worker's environment using `npx wrangler secret put JWT_SECRET` if you haven't already!

9.  **Access Aura Chat:** 🎉
    Open your browser and navigate to the URL provided by `wrangler dev` (for local) or your Worker's URL (for deployed).

### First Use: The Admin's Ascension 👑

*   On the very first launch (if no admin account has been set up), Aura Chat will magically guide you through the **Admin Account Setup**.
*   Create your primary administrator username and password.
*   Then, create the **Master Password**. This is super important – it's your key to the Admin Aura Panel! Keep it safe! 🗝️

---

## 🚀 Usage Guide 🗺️

1.  **Enter the Aura:**
    *   **User Login:** Use your created credentials. If you don't have an account, an admin needs to create one for you.
    *   **Admin Login:** Click the "Admin Access" tab, enter the **Master Password**, and unlock the Admin Aura Panel!
2.  **Chat Away:** 💬
    *   The left panel (desktop) or slide-out panel (mobile) shows available users and conversations.
    *   Click on a user to initiate or continue a 1-on-1 chat.
3.  **Master Your Messages:**
    *   **Hover** over a message to reveal action buttons:
        *   ↩️ **Reply:** Quote a message in your response.
        *   ✏️ **Edit:** (Your messages only) Modify what you said.
        *   🗑️ **Delete:** (Your messages only) Make it disappear.
    *   **Swipe right** (on mobile/touch) on a received message to quickly reply!
4.  **Explore Features:**
    *   🚫 **Manage Blocks:** Access via the user-slash icon in your profile header.
    *   🌓 **Toggle Theme:** Click the sun/moon icon.
    *   🚪 **Logout:** Find the exit icon.
    Have fun exploring all the nooks and crannies of Aura Chat! 🥳

---

## 🤝 Contributing - Join the Aura! 🙌

Aura Chat thrives on community energy! If you have ideas to make it even more magical:

1.  **Fork** the repository 🍴.
2.  Create your enchanting new **branch** (`git checkout -b feature/your-sparkling-idea`) 🌱.
3.  Weave your coding magic 👨‍💻.
4.  **Commit** your spells (`git commit -m 'Add ✨ new sparkling feature'`) 💾.
5.  **Push** to your branch (`git push origin feature/your-sparkling-idea`) ⬆️.
6.  Open a **Pull Request** and share your brilliance 🙏.

Please try to follow the existing code style. High-fives for contributions! ✋

---

## 🙏 Acknowledgements 🎉

*   A big thank you to the mystical beings behind [Font Awesome](https://fontawesome.com/) <i class="fa-brands fa-font-awesome"></i> for the icons.
*   Gratitude to [Google Fonts](https://fonts.google.com/) for "Poppins" and "Inter" 🅰️, adding to the visual charm.
*   Powered by the awesome Cloudflare ecosystem! ☁️

---

### ✨ May your conversations be vibrant with Aura Chat! 🔮🚀
