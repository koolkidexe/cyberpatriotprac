# Usage: python3 scripts/make-mint-wallpaper.py /tmp/wall.svg  (run from the project root), then render the SVG to
# assets/wallpaper-mint.jpg at 1920x1200 (e.g. a headless-browser screenshot). The JPEG is what the site loads.
# Linux Mint 21 style wallpaper: a wall of square blocks seen in perspective, a light beam from above,
# and a raised silver logo on the wall. Pure geometry -> SVG polygons (perspective computed here, since SVG can't).
import math, random, base64, sys
random.seed(7)
W, H = 1920, 1200
f = 1500.0; cx, cy = W * 0.50, H * 0.50
def proj(p):
    x, y, z = p
    return (cx + f * x / z, cy - f * y / z)
a = math.radians(-32)  # wall turned so its left side is further away
t = math.radians(38)   # top tilted away (seen from below)
U = (math.cos(a), 0.0, math.sin(a))
V = (0.0, math.cos(t), math.sin(t))
N = (U[1]*V[2]-U[2]*V[1], U[2]*V[0]-U[0]*V[2], U[0]*V[1]-U[1]*V[0])
if N[2] > 0: N = tuple(-c for c in N)   # normal points toward the camera
O = (-1.0, -3.0, 10.0)
def P(u, v, h=0.0): return tuple(O[i] + u*U[i] + v*V[i] + h*N[i] for i in range(3))
def poly(pts, fill, stroke=None, op=None):
    d = ' '.join(f'{x:.1f},{y:.1f}' for x, y in (proj(p) for p in pts))
    s = f'<polygon points="{d}" fill="{fill}"'
    if stroke: s += f' stroke="{stroke}" stroke-width="1"'
    if op: s += f' fill-opacity="{op}"'
    return s + '/>'
def g(v): v = max(0, min(255, int(v))); return f'#{v:02x}{v:02x}{min(255, v+1):02x}'
out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">',
       '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151516"/><stop offset="1" stop-color="#070707"/></linearGradient>',
       '<radialGradient id="beam" cx="0.5" cy="0" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".11"/><stop offset=".6" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
       '<radialGradient id="vig" cx="0.55" cy="0.42" r="0.75"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>',
       '<filter id="silver"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="gamma" amplitude="1.25" exponent="0.75" offset="0.02"/><feFuncG type="gamma" amplitude="1.25" exponent="0.75" offset="0.02"/><feFuncB type="gamma" amplitude="1.27" exponent="0.75" offset="0.03"/></feComponentTransfer></filter>',
       '<filter id="dark"><feColorMatrix type="matrix" values="0 0 0 0 0.06 0 0 0 0 0.06 0 0 0 0 0.065 0 0 0 1 0"/></filter></defs>',
       f'<rect width="{W}" height="{H}" fill="url(#bg)"/>']
blocks = []
for u in range(-40, 30):
    for v in range(-12, 60):
        h = random.choice([0, 0, 0, 0.06, 0.12, 0.18, 0.28]) * (1.0 if random.random() < .5 else 0.6)
        c = P(u + .5, v + .5, h)
        if c[2] < 1.5: continue
        blocks.append((c[2], u, v, h))
blocks.sort(reverse=True)  # far first
for z, u, v, h in blocks:
    shade = 25 - 9 * min(1, max(0, (z - 6) / 25)) + random.uniform(-4, 4) + h * 40
    b = [P(u, v), P(u+1, v), P(u+1, v+1), P(u, v+1)]
    fr = [P(u, v, h), P(u+1, v, h), P(u+1, v+1, h), P(u, v+1, h)]
    if h > 0:
        out.append(poly([b[3], b[2], fr[2], fr[3]], g(shade + 26)))   # top edge catches the light
        out.append(poly([b[0], b[3], fr[3], fr[0]], g(shade - 12)))   # left side in shadow
        out.append(poly([b[0], b[1], fr[1], fr[0]], g(shade - 16)))
    out.append(poly(fr, g(shade), stroke='rgba(0,0,0,.55)'))
    out.append(poly([fr[3], fr[2], P(u+1, v+1, h+0.0)], 'none', stroke='rgba(255,255,255,.07)'))
# light beam from the top
out.append(f'<polygon points="{W*0.42:.0f},0 {W*0.66:.0f},0 {W*0.98:.0f},{H} {W*0.22:.0f},{H}" fill="url(#beam)"/>')
# raised silver logo on the wall (affine fit of the logo square to the projected wall square)
logo = base64.b64encode(open('assets/logo-mint-outline.png', 'rb').read()).decode()
u0, v0, L = 0.4, 2.0, 4.8
def logo_at(h, filt):
    A = proj(P(u0, v0 + L, h)); B = proj(P(u0 + L, v0 + L, h)); C = proj(P(u0, v0, h))
    a_, b_ = (B[0]-A[0], B[1]-A[1]); c_, d_ = (C[0]-A[0], C[1]-A[1])
    return f'<image href="data:image/png;base64,{logo}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="matrix({a_:.3f} {b_:.3f} {c_:.3f} {d_:.3f} {A[0]:.2f} {A[1]:.2f})" filter="url(#{filt})"/>'
for i in range(10): out.append(logo_at(0.04 + i * 0.045, 'dark'))
out.append(logo_at(0.50, 'silver'))
out.append(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
out.append('</svg>')
open(sys.argv[1], 'w').write('\n'.join(out))
print(len(blocks), 'blocks')
