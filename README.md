
# NPC Portrait Switcher
 
> ⚠️ Author is a ROS2/C++ programmer — this extension is 99% vibe-coded JS/CSS. May conflict with other extensions that add containers to the right side of the chat.
 
A lightweight SillyTavern extension for narrator/DM setups. When your DM character's message contains an NPC's name (or any keyword you define), their portrait automatically appears on the right side of the chat window — mirroring ST's native left-side character panel.
 
Supports **expression overrides**: if both a character keyword and an expression keyword appear in the same message, the matching expression portrait is shown instead of the default.

Supports **mutliple npc instance**: new icon tray appears above portrait of all the recently mentioned NPCs. User can switch which NPC is in the main/select view.
 
The portrait is interactive — hover to reveal `‹ ›` arrows to manually cycle through all portraits for that character.
 
## Installation
 
1. In SillyTavern, open the **Extensions** panel (puzzle-piece icon)
2. Click **Install extension** and paste:
```
   https://github.com/NoaThouard/SillyTavern-Extension-NPC-Portait-Switcher
```
   Or manually copy this folder into:
```
   SillyTavern/public/scripts/extensions/third-party/npc-portrait-switcher/
```
3. Reload SillyTavern
## Setup
 
1. Open the **Extensions** panel and find **NPC Portrait Switcher**
2. Click **+ Add NPC** for each character you want
3. Type the keyword(s) to watch for, comma separated (e.g. `Vexis, Vex`)
4. Upload their default portrait — a 2:3 crop dialog will open automatically
5. Optionally add **expressions** under each NPC — each expression has its own keyword(s) and image
6. Optionally set a **Sticky duration** — seconds the portrait lingers after no match (0 = clears immediately on next non-matching message)
## How it works
 
- After every AI message, the extension scans the text for your keywords
- **Character match first**: the first NPC entry whose keyword appears in the message wins
- **Expression match second**: within that character, the first expression whose keyword also appears wins — otherwise the default portrait is shown
- The portrait appears in a dedicated panel on the right side of the chat, styled to match ST's native left-side zoomed avatar
- Keyword matching is case-insensitive by default (toggle in settings)
- Hover the portrait to reveal: a **✕** close button and **‹ ›** arrows to manually cycle portraits
## Examples

<img width="400" alt="default portrait" src="https://github.com/user-attachments/assets/298d3e3b-871e-475b-b4ac-6704e3e32ba0" />
<img width="400" alt="angry expression" src="https://github.com/user-attachments/assets/ddf6620c-e169-43b8-b791-7c026a83ee8f" />

## Tips
 
- Works best with **Visual Novel Mode** enabled (wider side panels)
- Separate multiple keywords with commas: `Vexis, Vex, the drow`
- Portrait clears automatically on chat switch
- The manual `‹ ›` arrows let you browse all expressions for the current character regardless of what was detected
## Notes
 
- Images are stored as **base64 inside SillyTavern's settings** — keep portraits under ~500KB to avoid bloating the settings file
- All uploaded images are cropped to **2:3 portrait ratio** (512×768) automatically
- Expressions are checked in the order you define them — first match wins
