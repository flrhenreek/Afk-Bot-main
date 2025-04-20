<p align="center">
    <strong>Functional Minecraft AFK bot for servers</strong>
  </p>

  <p align="center">
    Anti-AFK, Auto-Auth, Microsoft/Offline accounts support.
  </p>

  <h2>Installation</h2>
  <ol>
    <li>Download the latest package.</li>
    <li>Download & install <a href="https://nodejs.org/en/download/">Node.js</a></li>
    <li>Run <code>npm install</code> in the bot directory.</li>
    <li>Create a <code>settings.json</code> file and copy <code>settings.example.json</code>.</li>
  </ol>

  <h2>Usage</h2>
  <ol>
    <li>Configure the bot in <code>settings.json</code>. See the <a href="https://urfate.gitbook.io/afk-bot/bot-configuration">wiki</a> for detailed instructions.</li>
    <li>Start the bot with <code>node .</code></li>
  </ol>

  <h2>Using Commands</h2>
  <ul>
    <li><code>/say &lt;message&gt;</code>: Send a chat message.</li>
    <li><code>/reconnect</code>: Reconnect to the server.</li>
    <li><code>/quit</code>: Stop the bot.</li>
  </ul>

  <h2>Features</h2>
  <ul>
    <li>Anti-AFK Kick Module</li>
    <li>Move to target block after join</li>
    <li>Chat log</li>
    <li>Chat messages module</li>
    <li>Auto reconnect</li>
    <li>Supported versions: <code>1.8 - 1.19.3</code></li>
    <li>User commands</li>
  </ul>

  <hr>

  <h2>🔧 Multi-Server Support & GUI Slot Navigation</h2>
  <p>The bot can connect to multiple servers. A menu appears at startup to let you choose which server to AFK on.</p>

  <h3>🛠 How to Add a Server</h3>
  <p>Add this to the <code>servers</code> array in <code>settings.json</code>:</p>

  <pre><code>{
  "name": "server_name",
  "ip": "server.ip.address",
  "port": 25565,
  "version": "1.18.2",
  "password": "your_password",
  "delays": {
    "texturePackLoad": 5000
  },
  "gui-navigation": [
    { "type": "useCompass", "hotbarSlot": 4, "delay": 2000 },
    { "type": "clickWindow", "slot": 14, "delay": 3000 },
    { "type": "clickWindow", "slot": 20, "delay": 3000 }
  ]
}
</code></pre>

  <h3>⏱ Delays</h3>
  <p>Delay values are in milliseconds and are used to wait between actions.</p>

  <pre><code>"delays": {
  "texturePackLoad": 5000
}</code></pre>

  <h3>🧭 GUI Actions</h3>
  <p>The <code>gui-navigation</code> steps tell the bot what actions to perform:</p>
  <ul>
    <li><strong>rightClick</strong>: Right-clicks (e.g. to teleport to lobby)</li>
    <li><strong>useCompass</strong>: Selects a hotbar slot and uses the item</li>
    <li><strong>clickWindow</strong>: Clicks a specific slot in a GUI window</li>
  </ul>

  <h3>🔢 Slot Index Guide</h3>
  <p>Minecraft GUI slots are counted left-to-right, top-to-bottom starting from 0.</p>

  <p><strong>6×9 Chest GUI Example:</strong></p>
  <table border="1" cellpadding="6" cellspacing="0">
    <thead>
      <tr><th>Row</th><th>Slot Range</th><th>6th Slot in Row</th></tr>
    </thead>
    <tbody>
      <tr><td>1st</td><td>0–8</td><td>5</td></tr>
      <tr><td>2nd</td><td>9–17</td><td>14</td></tr>
      <tr><td>3rd</td><td>18–26</td><td>23</td></tr>
      <tr><td>4th</td><td>27–35</td><td>32</td></tr>
      <tr><td>5th</td><td>36–44</td><td>41</td></tr>
      <tr><td>6th</td><td>45–53</td><td>50</td></tr>
    </tbody>
  </table>

  <p><strong>Formula:</strong><br>
  <code>slot = (row - 1) × 9 + (column - 1)</code></p>

  <p><strong>Examples:</strong></p>
  <ul>
    <li>2nd row, 6th column → <code>(2 - 1) × 9 + (6 - 1) = 14</code></li>
    <li>3rd row, 3rd column → <code>(3 - 1) × 9 + (3 - 1) = 20</code></li>
  </ul>

  <hr>

  <h2>Credits</h2>
  <p><strong>THIS IS UrFate's BOT!</strong> (heavily modified)</p>