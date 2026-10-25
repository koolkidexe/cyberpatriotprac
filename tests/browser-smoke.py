from playwright.sync_api import sync_playwright
import sys
with sync_playwright() as p:
    try:
        b = p.chromium.launch()
    except Exception as e:
        print("LAUNCH FAIL", str(e)[:300]); sys.exit(1)
    pg = b.new_page(viewport={'width':1280,'height':800})
    errs=[]
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
    pg.goto('http://localhost:8099/')
    pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/cpsim-shot1.png')
    pg.click('.term'); 
    pg.keyboard.type('id'); pg.keyboard.press('Enter')
    pg.keyboard.type('ls -la ~/Desktop'); pg.keyboard.press('Enter')
    pg.keyboard.type('sudo ss -tulpn | grep 4444'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(500)
    pg.keyboard.type('sudo chmod 640 /etc/shadow'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(800)
    pg.screenshot(path='/tmp/cpsim-shot2.png')
    print('score', pg.inner_text('#sc'))
    print('\n'.join(errs[:10]))
    b.close()
