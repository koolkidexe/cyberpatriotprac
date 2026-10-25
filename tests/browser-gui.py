from playwright.sync_api import sync_playwright
def auth(pg):
    pg.fill('#overlay input[type=password]', 'cyberpatriot'); pg.click('#overlay [data-r="1"]'); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
    pg.goto('http://localhost:8099/'); pg.wait_for_timeout(1000)
    # Users and Groups: remove kali, demote casey, promote dana
    pg.evaluate("cpsim.launch('users-admin',[])"); pg.wait_for_timeout(300)
    def row(name): pg.click(f"tbody tr:has-text('{name}') td >> nth=0"); pg.wait_for_timeout(150)
    row('kali'); pg.click('[data-a=del]'); pg.wait_for_timeout(200); auth(pg); pg.click('#overlay [data-r="1"]'); pg.wait_for_timeout(300)
    row('casey'); pg.click('[data-a=type]'); pg.wait_for_timeout(200); pg.wait_for_timeout(100)
    row('dana'); pg.click('[data-a=type]'); pg.wait_for_timeout(300)
    print('after users', pg.inner_text('#sc'))
    pg.screenshot(path='/tmp/cpsim-g_users.png')
    # Firewall
    pg.evaluate("cpsim.launch('gufw',[])"); pg.wait_for_timeout(300)
    pg.click('.win >> nth=-1 >> [data-a=toggle]'); pg.wait_for_timeout(300); auth(pg)
    print('after ufw', pg.inner_text('#sc'))
    # Updates
    pg.evaluate("cpsim.launch('mintupdate',[])"); pg.wait_for_timeout(300)
    try:
        pg.click('.win >> nth=-1 >> [data-a=install]', timeout=3000)
    except Exception as e:
        print('FAIL', str(e)[:600]); pg.screenshot(path='/tmp/cpsim-fail.png'); raise
    pg.wait_for_timeout(300); auth(pg)
    print('after updates', pg.inner_text('#sc'))
    # Software manager: remove john
    pg.evaluate("cpsim.launch('mintinstall',[])"); pg.wait_for_timeout(300)
    pg.fill('.win >> nth=-1 >> input[type=text]', 'john'); pg.press('.win >> nth=-1 >> input[type=text]', 'Enter'); pg.wait_for_timeout(300)
    pg.click(".win >> nth=-1 >> [data-p='john']"); pg.wait_for_timeout(300); auth(pg); pg.click('#overlay [data-r="1"]'); pg.wait_for_timeout(300)
    print('after software', pg.inner_text('#sc'))
    # Startup apps: remove autostart
    pg.evaluate("cpsim.launch('startup-apps',[])"); pg.wait_for_timeout(300)
    pg.click('.win >> nth=-1 >> [data-p]'); pg.wait_for_timeout(200); pg.click('#overlay [data-r="1"]'); pg.wait_for_timeout(300)
    print('after startup', pg.inner_text('#sc'))
    # Login window: uncheck guest
    pg.evaluate("cpsim.launch('login-window',[])"); pg.wait_for_timeout(300)
    pg.uncheck('.win >> nth=-1 >> input[type=checkbox]', no_wait_after=True); pg.wait_for_timeout(300); auth(pg)
    print('after login', pg.inner_text('#sc'))
    pg.evaluate("cpsim.launch('gnome-system-monitor',[])"); pg.wait_for_timeout(300)
    pg.evaluate("cpsim.launch('cinnamon-settings',[])"); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/cpsim-g_all.png')
    print(errs); b.close()
