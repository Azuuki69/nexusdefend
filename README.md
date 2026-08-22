# NexusDefend

An HTML5 game with custom texture support.

## Project Structure

```
nexusdefend/
├── index.html          # Main game file
├── assets/
│   ├── textures/       # Store your custom textures here (PNG, JPG, etc.)
│   ├── sounds/         # Game sounds and music
│   └── sprites/        # Sprite sheets
├── js/
│   └── game.js         # Game logic (optional, when you split from HTML)
├── css/
│   └── style.css       # Styling (optional)
└── README.md           # This file
```

## Setup

1. Clone this repository
2. Add your texture images to `assets/textures/`
3. Reference them in your game code using relative paths
4. Open `index.html` in a web browser to play

## Using Custom Textures

To load textures from this repository:

```javascript
const textureUrl = './assets/textures/your-texture.png';
const image = new Image();
image.src = textureUrl;
```

## Git LFS for Large Files (Optional)

If you have large texture files (>50MB), consider using Git LFS:

```bash
git lfs install
git lfs track "*.png" "*.jpg" "*.mp3"
```

Then commit as normal.
