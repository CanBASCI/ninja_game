# Ninja Game

## Klasör yapısı

```
src/
  main.js                 # bootstrap + game loop
  scene/                  # sahne / dünya
    index.js
    createScene.js        # renderer, kamera, ışık, zemin, engeller
    input.js              # klavye
  main_char/              # ana oyuncu
    index.js
    MainChar.js           # yükleme, animasyon, hareket, vault/ip
    anims.js              # anim isimleri + hızlar
    look.js               # karakter görünüm paneli
public/
  main_char/
    ninja.glb             # Meshy All_Animations
```

## Çalıştırma

```bash
cd /Users/cb0007/Public/workspace/ninja_game
python3 -m http.server 5173
```

http://localhost:5173

## Kontroller

### Hareket
| Tuş | Aksiyon |
|-----|---------|
| A / D veya ← / → | Yürü |
| Shift + hareket | Koş |
| Ctrl + hareket | Sprint |
| ↓ / S | Çömel / çömelerek yürü |
| F + hareket | Savaş yürüyüşü |
| G + hareket | Ağır taşı |

### Zıpla / parkour
| Tuş | Aksiyon |
|-----|---------|
| ↑ / W | Regular Jump |
| Koşarken ↓ | Slide (`slide_light`) |
| Space | Parkour vault |
| R | Vault + roll |

### Saldırı / özel
| Tuş | Aksiyon |
|-----|---------|
| J | Kılıç (`Reaping_Swing`) |
| K | Ok |
| L | Çift bıçak spin (`Double_Blade_Spin`) |
| 1 (basılı) + ←/→ | Yüzme (stand) — anim değişmez, sadece hareket |
| 3 | Rope (çık → bekle → tekrar 3 in) |
