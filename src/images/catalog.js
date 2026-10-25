// The simulated apt repository and systemd unit catalog.
// A package definition describes what it puts on disk (binaries, default config) and which
// services it ships, so install / remove / purge behave like the real thing.
import * as C from './configs.js';

const ARCH = 'amd64';
export const ARCHITECTURE = ARCH;

export const PACKAGES = {};
export const SERVICES = {};

function pseudoSize(name, min = 24000, span = 1400000) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return min + (h % span);
}

/** Define a package. `o` keys: s section, size (kB), dep[], bins[], files{}, conf{}, svc[], gui{}, essential, avail, auto, installed */
function pkg(name, v, d, o = {}) {
  PACKAGES[name] = { name, v, d, s: 'misc', size: o.size ?? Math.max(40, Math.round(pseudoSize(name, 40, 20000) / 10)), dep: [], bins: [], files: {}, conf: {}, svc: [], arch: ARCH, ...o };
  return PACKAGES[name];
}

/** Define a systemd service unit. */
function svc(name, o) {
  SERVICES[name] = { name, unit: `${name}.service`, type: 'simple', user: 'root', listen: [], enabledByDefault: true, ...o };
}

// ------------------------------------------------------------------ base system (installed on every image)
const BASE = [
  ['base-files', '13ubuntu10.1', 'Debian base system miscellaneous files', { essential: true }],
  ['base-passwd', '3.6.3build1', 'Debian base system master password and group files', { essential: true }],
  ['bash', '5.1-6ubuntu1.1', 'GNU Bourne Again SHell', { essential: true, bins: ['/usr/bin/bash'] }],
  ['coreutils', '8.32-4.1ubuntu1.2', 'GNU core utilities', { essential: true }],
  ['dpkg', '1.22.6ubuntu6.1', 'Debian package management system', { essential: true }],
  ['apt', '2.7.14build2', 'commandline package manager', { essential: true }],
  ['login', '1:4.13+dfsg1-4ubuntu3.2', 'system login tools', { essential: true }],
  ['passwd', '1:4.13+dfsg1-4ubuntu3.2', 'change and administer password and group data', { essential: true }],
  ['util-linux', '2.39.3-9ubuntu6.1', 'miscellaneous system utilities', { essential: true }],
  ['procps', '2:4.0.4-4ubuntu3.2', '/proc file system utilities', { essential: true }],
  ['sed', '4.9-2build1', 'GNU stream editor for filtering/transforming text', { essential: true }],
  ['grep', '3.11-4build1', 'GNU grep, egrep and fgrep', { essential: true }],
  ['findutils', '4.9.0-5build1', 'utilities for finding files--find, xargs', { essential: true }],
  ['gzip', '1.12-1ubuntu3', 'GNU compression utilities', { essential: true }],
  ['tar', '1.35+dfsg-3build1', 'GNU version of the tar archiving utility', { essential: true }],
  ['mount', '2.39.3-9ubuntu6.1', 'tools for mounting and manipulating filesystems', { essential: true }],
  ['libc6', '2.35-0ubuntu3.8', 'GNU C Library: Shared libraries', { essential: true }],
  ['systemd', '249.11-0ubuntu3.12', 'system and service manager', { essential: true }],
  ['systemd-sysv', '249.11-0ubuntu3.12', 'system and service manager - SysV compatibility symlinks', { essential: true }],
  ['dash', '0.5.12-6ubuntu5', 'POSIX-compliant shell', { essential: true }],
  ['diffutils', '1:3.10-1build1', 'File comparison utilities', { essential: true }],
  ['hostname', '3.23+nmu2ubuntu2', 'utility to set/show the host name or domain name', { essential: true }],
  ['init-system-helpers', '1.66ubuntu1', 'helper tools for all init systems', { essential: true }],
  ['libpam-modules', '1.5.3-5ubuntu5.1', 'Pluggable Authentication Modules for PAM', { essential: true }],
  ['libpam-runtime', '1.5.3-5ubuntu5.1', 'Runtime support for the PAM library', { essential: true }],
  ['libpam-pwquality', '1.4.5-3build1', 'PAM module to check password strength'],
  ['libpam0g', '1.5.3-5ubuntu5.1', 'Pluggable Authentication Modules library', { essential: true }],
  ['iproute2', '6.1.0-1ubuntu6', 'networking and traffic control tools'],
  ['iputils-ping', '3:20240117-1build1', 'Tools to test the reachability of network hosts'],
  ['net-tools', '2.10-0.1ubuntu4', 'NET-3 networking toolkit'],
  ['nano', '7.2-2build1', 'small, friendly text editor inspired by Pico', { bins: ['/usr/bin/nano'] }],
  ['vim-tiny', '2:9.1.0016-1ubuntu7.3', 'Vi IMproved - enhanced vi editor - compact version', { bins: ['/usr/bin/vi'] }],
  ['less', '590-2ubuntu2', 'pager program similar to more', { bins: ['/usr/bin/less'] }],
  ['curl', '8.5.0-2ubuntu10.5', 'command line tool for transferring data with URL syntax', { bins: ['/usr/bin/curl'] }],
  ['wget', '1.21.4-1ubuntu4.1', 'retrieves files from the web', { bins: ['/usr/bin/wget'] }],
  ['ca-certificates', '20240203', 'Common CA certificates'],
  ['openssl', '3.0.2-0ubuntu1.15', 'Secure Sockets Layer toolkit - cryptographic utility', { bins: ['/usr/bin/openssl'], avail: '3.0.2-0ubuntu1.18' }],
  ['libssl3', '3.0.2-0ubuntu1.15', 'Secure Sockets Layer toolkit - shared libraries', { avail: '3.0.2-0ubuntu1.18' }],
  ['python3', '3.10.6-1~22.04.1', 'interactive high-level object-oriented language (default python3 version)', { bins: ['/usr/bin/python3'] }],
  ['git', '1:2.43.0-1ubuntu7.1', 'fast, scalable, distributed revision control system', { bins: ['/usr/bin/git'] }],
  ['bsdutils', '1:2.39.3-9ubuntu6.1', 'basic utilities from 4.4BSD-Lite', { essential: true }],
  ['rsyslog', '8.2312.0-3ubuntu9', 'reliable system and kernel logging daemon', { bins: ['/usr/sbin/rsyslogd'], svc: ['rsyslog'] }],
  ['dbus', '1.14.10-4ubuntu4.1', "simple interprocess messaging system (system message bus)", { bins: ['/usr/bin/dbus-daemon'], svc: ['dbus'] }],
  ['polkitd', '124-2ubuntu1.1', 'framework for managing administrative policies and privileges - daemon', { bins: ['/usr/lib/polkit-1/polkitd'], svc: ['polkit'] }],
  ['accountsservice', '23.13.9-2ubuntu6', 'query and manipulate user account information', { svc: ['accounts-daemon'] }],
  ['apparmor', '3.0.4-2ubuntu2.4', 'user-space parser utility for AppArmor', { bins: ['/usr/sbin/apparmor_parser'], svc: ['apparmor'] }],
  ['udisks2', '2.10.1-6ubuntu1', 'D-Bus service to access and manipulate storage devices', { svc: ['udisks2'] }],
  ['network-manager', '1.46.0-1ubuntu2.2', 'network management framework (daemon and userspace tools)', { bins: ['/usr/sbin/NetworkManager'], svc: ['NetworkManager'] }],
  ['wpasupplicant', '2:2.10-21ubuntu0.1', 'client support for WPA and WPA2 (IEEE 802.11i)', { svc: ['wpa_supplicant'] }],
  ['bluez', '5.72-0ubuntu5.2', 'Bluetooth tools and daemons', { svc: ['bluetooth'] }],
  ['modemmanager', '1.23.4-0ubuntu2', 'D-Bus service for managing modems', { svc: ['ModemManager'] }],
  ['avahi-daemon', '0.8-13ubuntu6', 'Avahi mDNS/DNS-SD daemon', { bins: ['/usr/sbin/avahi-daemon'], svc: ['avahi-daemon'] }],
  ['cups', '2.4.7-1.2ubuntu7.3', 'Common UNIX Printing System(tm) - PPD/driver support, web interface', { svc: ['cups'], conf: { '/etc/cups/cupsd.conf': C.CUPS_FILES_CONF } }],
  ['cups-daemon', '2.4.7-1.2ubuntu7.3', 'Common UNIX Printing System(tm) - daemon', { bins: ['/usr/sbin/cupsd'] }],
  ['cups-browsed', '2.0.0-0ubuntu10.1', 'OpenPrinting cups-browsed - Daemon for browsing the Bonjour broadcasts of shared, remote CUPS printers', { bins: ['/usr/sbin/cups-browsed'], svc: ['cups-browsed'] }],
  ['cron', '3.0pl1-184ubuntu2', 'process scheduling daemon', { bins: ['/usr/sbin/cron', '/usr/bin/crontab'], svc: ['cron'] }],
  ['openssh-client', '1:8.9p1-3ubuntu0.7', 'secure shell (SSH) client, for secure access to remote machines', { bins: ['/usr/bin/ssh', '/usr/bin/scp', '/usr/bin/ssh-keygen'], avail: '1:8.9p1-3ubuntu0.10' }],
  ['openssh-sftp-server', '1:8.9p1-3ubuntu0.7', 'secure shell (SSH) sftp server module, for SFTP access from remote machines', { bins: ['/usr/lib/openssh/sftp-server'], avail: '1:8.9p1-3ubuntu0.10' }],
  ['netcat-traditional', '1.10-48', 'TCP/IP swiss army knife', { bins: ['/bin/nc.traditional'], files: {} }],
  ['ufw', '0.36.2-6', 'program for managing a Netfilter firewall', { bins: ['/usr/sbin/ufw'], svc: ['ufw'], dep: ['iptables'], conf: { '/etc/ufw/ufw.conf': C.UFW_CONF(false), '/etc/default/ufw': C.DEFAULT_UFW } }],
  ['iptables', '1.8.10-3ubuntu2', 'administration tools for packet filtering and NAT', { bins: ['/usr/sbin/iptables'] }],
  ['gufw', '22.04.3-1', 'graphical user interface for ufw', { bins: ['/usr/bin/gufw'], dep: ['ufw'], gui: { title: 'Firewall Configuration', summary: 'Configure your firewall with ease', cat: 'System Tools' } }],
  ['lightdm', '1.30.0-0ubuntu8', 'simple display manager', { bins: ['/usr/sbin/lightdm'], svc: ['lightdm'], conf: { '/etc/lightdm/lightdm.conf.d/70-linuxmint.conf': C.LIGHTDM_MINT } }],
  ['slick-greeter', '2.0.7', 'Slick-looking LightDM greeter', { conf: { '/etc/lightdm/slick-greeter.conf': C.SLICK_GREETER } }],
  ['sudo', '1.9.9-1ubuntu2.4', 'Provide limited super user privileges to specific users', { bins: ['/usr/bin/sudo'], conf: { '/etc/sudoers': C.SUDOERS } }],
  ['openssh-server', '1:8.9p1-3ubuntu0.7', 'secure shell (SSH) server, for secure access from remote machines', { bins: ['/usr/sbin/sshd'], svc: ['ssh'], dep: ['openssh-client', 'openssh-sftp-server'], conf: { '/etc/ssh/sshd_config': C.SSHD_CONFIG }, avail: '1:8.9p1-3ubuntu0.10' }],
  ['xed', '3.4.4', 'Text editor (Xed)', { bins: ['/usr/bin/xed'], gui: { title: 'Text Editor', summary: 'Xed is a small, but powerful text editor', cat: 'Accessories' } }],
  ['nemo', '6.0.2', 'File manager and graphical shell for Cinnamon', { bins: ['/usr/bin/nemo'], gui: { title: 'Files', summary: 'Access and organize files', cat: 'Accessories' } }],
  ['gnome-terminal', '3.52.0-1ubuntu3', 'GNOME Terminal emulator application', { bins: ['/usr/bin/gnome-terminal'], gui: { title: 'Terminal', summary: 'Use the command line', cat: 'System Tools' } }],
  ['cinnamon', '6.0.4', 'Modern Linux desktop', { bins: ['/usr/bin/cinnamon', '/usr/bin/cinnamon-settings'], gui: { title: 'System Settings', summary: 'Control Center', cat: 'System Tools', exec: 'cinnamon-settings' } }],
  ['mintupdate', '6.1.7', 'Update Manager', { bins: ['/usr/bin/mintupdate'], gui: { title: 'Update Manager', summary: 'Update your system', cat: 'System Tools' } }],
  ['mintinstall', '8.0.6', 'Software Manager', { bins: ['/usr/bin/mintinstall'], gui: { title: 'Software Manager', summary: 'Install new applications', cat: 'System Tools' } }],
  ['mintsources', '2.4.3', 'Software Sources', { bins: ['/usr/bin/mintsources'], gui: { title: 'Software Sources', summary: 'Configure the sources for installable software and updates', cat: 'System Tools' } }],
  ['gnome-system-monitor', '46.0-1ubuntu1', 'Process viewer and system resource monitor', { bins: ['/usr/bin/gnome-system-monitor'], gui: { title: 'System Monitor', summary: 'Manage processes and monitor system resources', cat: 'System Tools' } }],
  ['firefox', '128.0+linuxmint1+virginia', 'Safe and easy web browser from Mozilla', { bins: ['/usr/bin/firefox'], avail: '131.0.3+linuxmint1+virginia', gui: { title: 'Firefox Web Browser', summary: 'Browse the World Wide Web', cat: 'Internet', exec: 'firefox %u' }, size: 253000 }],
  ['thunderbird', '1:115.16.0+build2-0ubuntu0.22.04.1', 'Email, RSS and newsgroup client with integrated spam filter', { bins: ['/usr/bin/thunderbird'], gui: { title: 'Thunderbird Mail', summary: 'Send and receive mail with Thunderbird', cat: 'Internet' } }],
  ['libreoffice-common', '1:7.3.7-0ubuntu0.22.04.7', 'office productivity suite -- arch-independent files', { gui: { title: 'LibreOffice', summary: 'Free office suite', cat: 'Office', exec: 'libreoffice' } }],
  ['libreoffice-writer', '1:7.3.7-0ubuntu0.22.04.7', 'office productivity suite -- word processor', { bins: ['/usr/bin/libreoffice'], gui: { title: 'LibreOffice Writer', summary: 'Create and edit text documents', cat: 'Office', exec: 'libreoffice --writer' } }],
  ['libreoffice-calc', '1:7.3.7-0ubuntu0.22.04.7', 'office productivity suite -- spreadsheet', { gui: { title: 'LibreOffice Calc', summary: 'Create and edit spreadsheets', cat: 'Office', exec: 'libreoffice --calc' } }],
  ['celluloid', '0.26-1', 'simple GTK+ frontend for mpv', { bins: ['/usr/bin/celluloid'], gui: { title: 'Celluloid', summary: 'Play videos', cat: 'Sound and video' } }],
  ['rhythmbox', '3.4.7-1build3', 'music player and organizer for GNOME', { bins: ['/usr/bin/rhythmbox'], gui: { title: 'Rhythmbox', summary: 'Play and organize your music', cat: 'Sound and video' } }],
  ['hypnotix', '4.2', 'IPTV streaming application', { gui: { title: 'Hypnotix', summary: 'Watch TV', cat: 'Sound and video' } }],
  ['transmission-gtk', '4.0.5-1build3', 'lightweight BitTorrent client (GTK+ interface)', { bins: ['/usr/bin/transmission-gtk'], gui: { title: 'Transmission', summary: 'Download and share files over BitTorrent', cat: 'Internet' } }],
  ['warpinator', '1.8.7', 'Share files across the LAN', { gui: { title: 'Warpinator', summary: 'Send and receive files across the network', cat: 'Internet' } }],
  ['drawing', '1.0.2-1', 'Simple image editor', { gui: { title: 'Drawing', summary: 'Edit images', cat: 'Graphics' } }],
  ['pix', '3.4.5', 'Image viewer and browser', { gui: { title: 'Image Viewer', summary: 'Browse and organize photos', cat: 'Graphics' } }],
  ['xreader', '4.2.7', 'Document viewer', { gui: { title: 'Document Viewer', summary: 'View PDFs and documents', cat: 'Office' } }],
  ['timeshift', '24.06.6', 'System restore utility', { bins: ['/usr/bin/timeshift'], gui: { title: 'Timeshift', summary: 'Restore your computer to a previous state', cat: 'System Tools' } }],
  ['gnome-calculator', '1:46.1-1ubuntu1', 'GNOME desktop calculator', { gui: { title: 'Calculator', summary: 'Perform arithmetic and scientific calculations', cat: 'Accessories' } }],
  ['seahorse', '43.0-3build1', 'GNOME frontend for GnuPG', { gui: { title: 'Passwords and Keys', summary: 'Manage your passwords and encryption keys', cat: 'Accessories' } }],
  ['mintreport', '2.0.5', 'System reports', { gui: { title: 'System Reports', summary: 'Information about your system', cat: 'System Tools' } }],
  ['mintwelcome', '1.9.5', 'Welcome screen', { gui: { title: 'Welcome Screen', summary: 'Getting started with Linux Mint', cat: 'System Tools' } }],
  ['mintbackup', '2.1.0', 'Backup Tool', { gui: { title: 'Backup Tool', summary: 'Backup and restore your files', cat: 'System Tools' } }],
  ['mintstick', '1.6.6', 'USB Image Writer', { gui: { title: 'USB Image Writer', summary: 'Make a bootable USB stick', cat: 'System Tools' } }],
  ['bulky', '3.3', 'Bulk rename', { gui: { title: 'Bulk Rename', summary: 'Rename files in bulk', cat: 'Accessories' } }],
  ['sticky', '1.9', 'Sticky notes', { gui: { title: 'Notes', summary: 'Sticky notes for your desktop', cat: 'Accessories' } }],
  ['onboard', '1.4.1-6', 'Simple On-screen Keyboard', { gui: { title: 'Onboard', summary: 'On-screen keyboard', cat: 'Accessories' } }],
  ['system-config-printer', '1.5.18-1ubuntu1', 'graphical interface to configure the printing system', { gui: { title: 'Printers', summary: 'Configure printers', cat: 'System Tools' } }],
];
BASE.push(['lsof', '4.93.2+dfsg-1.1build2', 'utility to list open files', { bins: ['/usr/bin/lsof'] }]);
for (const [name, v, d, o] of BASE) pkg(name, v, d, { ...o, installed: true });

// filler: real packages that make `dpkg -l` look like a real machine (no behaviour attached)
const FILLER = [
  ['adduser', '3.137ubuntu1', 'add and remove users and groups'], ['apt-utils', '2.7.14build2', 'package management related utility programs'],
  ['bc', '1.07.1-3ubuntu4', 'GNU bc arbitrary precision calculator language'], ['bzip2', '1.0.8-5.1build0.1', 'high-quality block-sorting file compressor - utilities'],
  ['console-setup', '1.226ubuntu1', 'console font and keymap setup program'], ['cpio', '2.15+dfsg-1ubuntu2', 'GNU cpio -- a program to manage archives of files'],
  ['dbus-user-session', '1.14.10-4ubuntu4.1', 'simple interprocess messaging system (systemd --user integration)'], ['debconf', '1.5.86ubuntu1', 'Debian configuration management system'],
  ['e2fsprogs', '1.47.0-2.4~exp1ubuntu4.1', 'ext2/ext3/ext4 file system utilities'], ['file', '1:5.45-3build1', 'Recognize the type of data in a file using "magic" numbers'],
  ['fontconfig', '2.15.0-1.1ubuntu2', 'generic font configuration library - support binaries'], ['gawk', '1:5.2.1-2build3', 'GNU awk, a pattern scanning and processing language'],
  ['gcc-14-base', '14-20240412-0ubuntu1', 'GCC, the GNU Compiler Collection (base package)'], ['gpgv', '2.4.4-2ubuntu17', 'GNU privacy guard - signature verification tool'],
  ['info', '7.1-3build2', 'Standalone GNU Info documentation browser'], ['init', '1.66ubuntu1', 'metapackage ensuring an init system is installed'],
  ['kmod', '31+20240202-2ubuntu7', 'tools for managing Linux kernel modules'], ['libgcc-s1', '14-20240412-0ubuntu1', 'GCC support library'],
  ['linux-base', '4.5ubuntu9', 'Linux image base package'], ['linux-firmware', '20240318.git3b128b60-0ubuntu2.6', 'Firmware for Linux kernel drivers'],
  ['linux-generic', '5.15.0.126.126', 'Complete Generic Linux kernel and headers'], ['linux-image-generic', '5.15.0.126.126', 'Generic Linux kernel image'],
  ['locales', '2.35-0ubuntu3.8', 'GNU C Library: National Language (locale) data [support]'], ['lsb-release', '12.0-2', 'Linux Standard Base version reporting utility'],
  ['man-db', '2.12.0-4build2', 'tools for reading manual pages'], ['mawk', '1.3.4.20240123-1build1', 'Pattern scanning and text processing language'],
  ['media-types', '10.1.0', 'List of standard media types and their usual file extension'], ['ncurses-base', '6.4+20240113-1ubuntu2', 'basic terminal type definitions'],
  ['ncurses-bin', '6.4+20240113-1ubuntu2', 'terminal-related programs and man pages'], ['perl', '5.38.2-3.2build2', 'Larry Wall\'s Practical Extraction and Report Language'],
  ['pciutils', '1:3.10.0-2build1', 'PCI utilities'], ['plymouth', '24.004.60-1ubuntu7.1', 'boot animation, logger and I/O multiplexer'],
  ['readline-common', '8.2-4build1', 'GNU readline and history libraries, common files'], ['rsync', '3.2.7-1ubuntu1.2', 'fast, versatile, remote (and local) file-copying tool'],
  ['sensible-utils', '0.0.22', 'Utilities for sensible alternative selection'], ['sysvinit-utils', '3.08-6ubuntu3', 'System-V-like utilities'],
  ['tzdata', '2024a-0ubuntu0.22.04.1', 'time zone and daylight-saving time data'], ['ubuntu-keyring', '2023.11.28.1', 'GnuPG keys of the Ubuntu archive'],
  ['usbutils', '1:017-3build1', 'Linux USB utilities'], ['xz-utils', '5.6.1+really5.4.5-1build0.1', 'XZ-format compression utilities'],
  ['zip', '3.0-13ubuntu0.1', 'Archiver for .zip files'], ['unzip', '6.0-28ubuntu4.1', 'De-archiver for .zip files'],
  ['xserver-xorg-core', '2:21.1.12-1ubuntu1.1', 'Xorg X server - core server'], ['xorg', '1:7.7+23ubuntu3', 'X.Org X Window System'],
  ['pipewire', '1.0.5-1ubuntu3.1', 'audio and video processing engine multimedia server'], ['pulseaudio', '1:16.1+dfsg1-2ubuntu10.1', 'PulseAudio sound server'],
  ['gvfs', '1.54.2-1ubuntu1', 'userspace virtual filesystem - GIO module'], ['gnome-keyring', '46.1-1build1', 'GNOME keyring services (daemon and tools)'],
  ['xdg-utils', '1.1.3-4.1ubuntu3', 'desktop integration utilities from freedesktop.org'], ['mint-meta-core', '2.1.0', 'Linux Mint core metapackage'],
  ['mint-themes', '2.1.9', 'Mint-Y theme'], ['mint-y-icons', '1.7.4', 'Mint-Y icon theme'], ['mint-artwork', '1.8.3', 'Linux Mint artwork'],
  ['grub-efi-amd64', '2.12-1ubuntu7', 'GRand Unified Bootloader, version 2 (EFI-AMD64 version)'], ['shim-signed', '1.58+15.8-0ubuntu1', 'Secure Boot chain-loading bootloader (Microsoft-signed binary)'],
  ['tcpdump-stub', '0', 'placeholder'],
];
for (const [name, v, d] of FILLER) if (name !== 'tcpdump-stub') pkg(name, v, d, { installed: true });

// ------------------------------------------------------------------ scenario-relevant packages
pkg('vsftpd', '3.0.5-0ubuntu3', 'lightweight, efficient FTP server written for security', {
  s: 'net', bins: ['/usr/sbin/vsftpd'], svc: ['vsftpd'], conf: { '/etc/vsftpd.conf': C.VSFTPD_CONF }, files: { '/etc/ftpusers': 'root\ndaemon\nbin\nsys\nsync\ngames\nman\nlp\nmail\nnews\nuucp\nnobody\n' },
});
pkg('john', '1.9.0-2build2', 'active password cracking tool', { s: 'utils', bins: ['/usr/sbin/john', '/usr/sbin/unshadow'], dep: ['john-data'], size: 1080, files: { '/etc/john/john.conf': '# John the Ripper configuration file\n[Options]\nWordlist = $JOHN/password.lst\n' } });
pkg('john-data', '1.9.0-2build2', 'active password cracking tool - charset files', { s: 'utils', auto: true, size: 4900, files: { '/usr/share/john/password.lst': '#!comment: wordlist\n123456\npassword\n12345678\nqwerty\nabc123\n' } });
pkg('aisleriot', '1:3.22.32-1', 'GNOME solitaire card game collection', { s: 'games', bins: ['/usr/games/sol'], size: 16200, gui: { title: 'AisleRiot Solitaire', summary: 'Play a selection of card games', cat: 'Games' } });

// installable extras: some are tempting (security tools) and some are traps (open ports)
pkg('nmap', '7.94+git20230807.3be01efb1+dfsg-3build2', 'The Network Mapper', { s: 'net', bins: ['/usr/bin/nmap'], size: 4900 });
pkg('wireshark', '4.2.2-1.1build3', 'network traffic analyzer - meta-package', { s: 'net', bins: ['/usr/bin/wireshark'], size: 20400, gui: { title: 'Wireshark', summary: 'Network protocol analyzer', cat: 'Internet' } });
pkg('hydra', '9.5-1build2', 'very fast network logon cracker', { s: 'net', bins: ['/usr/bin/hydra'], size: 780 });
pkg('tcpdump', '4.99.4-3ubuntu4', 'command-line network traffic analyzer', { s: 'net', bins: ['/usr/bin/tcpdump'], size: 1200 });
pkg('telnet', '0.17+2.5-3ubuntu4', 'basic telnet client', { s: 'net', bins: ['/usr/bin/telnet.netkit'], size: 150 });
pkg('htop', '3.3.0-4build1', 'interactive processes viewer', { s: 'admin', bins: ['/usr/bin/htop'], size: 430 });
pkg('tree', '2.1.1-2ubuntu3', 'displays an indented directory tree, in color', { s: 'utils', bins: ['/usr/bin/tree'], size: 110 });
pkg('vim', '2:9.1.0016-1ubuntu7.3', 'Vi IMproved - enhanced vi editor', { s: 'editors', bins: ['/usr/bin/vim.basic'], size: 4000 });
pkg('build-essential', '12.10ubuntu1', 'Informational list of build-essential packages', { s: 'devel', size: 20 });
pkg('lynis', '3.0.9-1', 'security auditing tool for Unix based systems', { s: 'admin', bins: ['/usr/sbin/lynis'], size: 1000 });
pkg('chkrootkit', '0.58b-1', 'rootkit detector', { s: 'admin', bins: ['/usr/sbin/chkrootkit'], size: 400 });
pkg('rkhunter', '1.4.6-12', 'rootkit, backdoor, sniffer and exploit scanner', { s: 'admin', bins: ['/usr/bin/rkhunter'], size: 1400 });
pkg('clamav', '0.103.12+dfsg-0ubuntu0.22.04.1', 'anti-virus utility for Unix - command-line interface', { s: 'utils', bins: ['/usr/bin/clamscan', '/usr/bin/freshclam'], size: 2800 });
pkg('fail2ban', '1.0.2-3ubuntu0.1', 'ban hosts that cause multiple authentication errors', { s: 'net', bins: ['/usr/bin/fail2ban-client'], svc: ['fail2ban'], size: 2100, conf: { '/etc/fail2ban/jail.conf': '[DEFAULT]\nbantime = 10m\nfindtime = 10m\nmaxretry = 5\n' } });
pkg('auditd', '1:3.1.2-2.1build1', 'User space tools for security auditing', { s: 'admin', bins: ['/usr/sbin/auditd', '/usr/sbin/auditctl'], svc: ['auditd'], size: 800 });
pkg('unattended-upgrades', '2.9.1+nmu4ubuntu1', 'automatic installation of security upgrades', { s: 'admin', bins: ['/usr/bin/unattended-upgrade'], size: 340, conf: { '/etc/apt/apt.conf.d/50unattended-upgrades': '// Automatically upgrade packages from these (origin:archive) pairs\nUnattended-Upgrade::Allowed-Origins {\n\t"${distro_id}:${distro_codename}";\n\t"${distro_id}:${distro_codename}-security";\n};\n' } });
pkg('apparmor-utils', '3.0.4-2ubuntu2.4', 'utilities for controlling AppArmor', { s: 'admin', bins: ['/usr/sbin/aa-status'], size: 600 });
pkg('aide', '0.18.6-2build1', 'Advanced Intrusion Detection Environment - static binary', { s: 'admin', bins: ['/usr/bin/aide'], size: 400 });
pkg('apache2', '2.4.58-1ubuntu8.5', 'Apache HTTP Server', { s: 'httpd', bins: ['/usr/sbin/apache2'], svc: ['apache2'], size: 590, conf: { '/etc/apache2/apache2.conf': '# This is the main Apache server configuration file.\nServerRoot "/etc/apache2"\nTimeout 300\n' }, files: { '/var/www/html/index.html': '<html><body><h1>Apache2 Ubuntu Default Page: It works</h1></body></html>\n' } });
pkg('nginx', '1.24.0-2ubuntu7.1', 'small, powerful, scalable web/proxy server', { s: 'httpd', bins: ['/usr/sbin/nginx'], svc: ['nginx'], size: 1500, conf: { '/etc/nginx/nginx.conf': 'user www-data;\nworker_processes auto;\nevents { worker_connections 768; }\nhttp { server { listen 80 default_server; root /var/www/html; } }\n' } });
pkg('samba', '2:4.19.5+dfsg-4ubuntu9', 'SMB/CIFS file, print, and login server for Unix', { s: 'net', bins: ['/usr/sbin/smbd', '/usr/sbin/nmbd'], svc: ['smbd', 'nmbd'], size: 3400, conf: { '/etc/samba/smb.conf': '[global]\n   workgroup = WORKGROUP\n   server role = standalone server\n   map to guest = bad user\n' } });
pkg('bind9', '1:9.18.28-0ubuntu0.22.04.1', 'Internet Domain Name Server', { s: 'net', bins: ['/usr/sbin/named'], svc: ['named'], size: 1100 });
pkg('snmpd', '5.9.4+dfsg-1.1ubuntu3.1', 'SNMP (Simple Network Management Protocol) agents', { s: 'net', bins: ['/usr/sbin/snmpd'], svc: ['snmpd'], size: 280, conf: { '/etc/snmp/snmpd.conf': 'rocommunity public default\n' } });
pkg('postfix', '3.8.6-1build2', 'High-performance mail transport agent', { s: 'mail', bins: ['/usr/sbin/postfix'], svc: ['postfix'], size: 4000 });
pkg('openvpn', '2.6.9-1ubuntu4.1', 'virtual private network daemon', { s: 'net', bins: ['/usr/sbin/openvpn'], size: 1000 });
pkg('nfs-kernel-server', '1:2.6.4-3ubuntu5.1', 'support for NFS kernel server', { s: 'net', bins: ['/usr/sbin/exportfs'], svc: ['nfs-server'], size: 700 });
pkg('inetutils-telnetd', '2:2.5-3ubuntu4', 'telnet server', { s: 'net', bins: ['/usr/sbin/telnetd'], svc: ['telnetd'], size: 90 });
pkg('docker.io', '24.0.7-0ubuntu4.1', 'Linux container runtime', { s: 'admin', bins: ['/usr/bin/docker'], size: 130000 });
pkg('python3-pip', '24.0+dfsg-1ubuntu1', 'Python package installer', { s: 'python', bins: ['/usr/bin/pip3'], size: 4000 });
pkg('ssh-askpass', '1:1.2.4.1-1', 'under X, asks user for a passphrase for ssh-add', { s: 'x11', size: 100 });
pkg('libpam-google-authenticator', '20191231-2build2', 'Two-step verification', { s: 'admin', size: 50 });
pkg('cracklib-runtime', '2.9.6-5.1build2', 'runtime support for password checker library cracklib2', { s: 'admin', size: 400 });
pkg('libpam-cracklib', '0', 'placeholder', { missing: true });
delete PACKAGES['libpam-cracklib'];

// ------------------------------------------------------------------ services
const nameUser = (u) => u;
void nameUser;
svc('ssh', { desc: 'OpenBSD Secure Shell server', package: 'openssh-server', exec: '/usr/sbin/sshd -D', procName: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 22 }, { proto: 'tcp6', addr: '[::]', port: 22 }], alias: ['sshd'], docs: 'man:sshd(8) man:sshd_config(5)' });
svc('vsftpd', { desc: 'vsftpd FTP server', package: 'vsftpd', exec: '/usr/sbin/vsftpd /etc/vsftpd.conf', listen: [{ proto: 'tcp6', addr: '*', port: 21 }], docs: 'man:vsftpd.conf(5)' });
svc('cron', { desc: 'Regular background program processing daemon', package: 'cron', exec: '/usr/sbin/cron -f -P', docs: 'man:cron(8)' });
svc('cups', { desc: 'CUPS Scheduler', package: 'cups', exec: '/usr/sbin/cupsd -l', listen: [{ proto: 'tcp', addr: '127.0.0.1', port: 631 }, { proto: 'tcp6', addr: '[::1]', port: 631 }], docs: 'man:cupsd(8)' });
svc('cups-browsed', { desc: 'Make remote CUPS printers available locally', package: 'cups-browsed', exec: '/usr/sbin/cups-browsed', listen: [{ proto: 'udp', addr: '0.0.0.0', port: 631 }], docs: 'man:cups-browsed(8)' });
svc('avahi-daemon', { desc: 'Avahi mDNS/DNS-SD Stack', package: 'avahi-daemon', user: 'avahi', exec: 'avahi-daemon: running [mint.local]', execPath: '/usr/sbin/avahi-daemon -s', listen: [{ proto: 'udp', addr: '0.0.0.0', port: 5353 }, { proto: 'udp', addr: '0.0.0.0', port: 40421 }], docs: 'man:avahi-daemon(8)' });
svc('NetworkManager', { desc: 'Network Manager', package: 'network-manager', exec: '/usr/sbin/NetworkManager --no-daemon', listen: [{ proto: 'udp', addr: '10.0.2.15%enp0s3', port: 68 }], docs: 'man:NetworkManager(8)' });
svc('wpa_supplicant', { desc: 'WPA supplicant', package: 'wpasupplicant', exec: '/sbin/wpa_supplicant -u -s -O /run/wpa_supplicant' });
svc('bluetooth', { desc: 'Bluetooth service', package: 'bluez', exec: '/usr/libexec/bluetooth/bluetoothd', enabledByDefault: true });
svc('ModemManager', { desc: 'Modem Manager', package: 'modemmanager', exec: '/usr/sbin/ModemManager' });
svc('accounts-daemon', { desc: 'Accounts Service', package: 'accountsservice', exec: '/usr/libexec/accounts-daemon' });
svc('udisks2', { desc: 'Disk Manager', package: 'udisks2', exec: '/usr/libexec/udisks2/udisksd' });
svc('polkit', { desc: 'Authorization Manager', package: 'polkitd', user: 'polkitd', exec: '/usr/lib/polkit-1/polkitd --no-debug' });
svc('dbus', { desc: 'D-Bus System Message Bus', package: 'dbus', user: 'messagebus', exec: '@dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only' });
svc('rsyslog', { desc: 'System Logging Service', package: 'rsyslog', user: 'syslog', exec: '/usr/sbin/rsyslogd -n -iNONE' });
svc('lightdm', { desc: 'Light Display Manager', package: 'lightdm', exec: '/usr/sbin/lightdm' });
svc('apparmor', { desc: 'Load AppArmor profiles', package: 'apparmor', type: 'oneshot', exec: '/lib/apparmor/apparmor.systemd reload' });
svc('ufw', { desc: 'Uncomplicated firewall', package: 'ufw', type: 'oneshot', exec: '/lib/ufw/ufw-init start quiet', docs: 'man:ufw(8)' });
svc('systemd-resolved', { desc: 'Network Name Resolution', package: 'systemd', user: 'systemd-resolve', exec: '/lib/systemd/systemd-resolved', listen: [{ proto: 'tcp', addr: '127.0.0.53%lo', port: 53 }, { proto: 'udp', addr: '127.0.0.53%lo', port: 53 }, { proto: 'tcp', addr: '127.0.0.54', port: 53 }, { proto: 'udp', addr: '127.0.0.54', port: 53 }] });
svc('apache2', { desc: 'The Apache HTTP Server', package: 'apache2', exec: '/usr/sbin/apache2 -k start', listen: [{ proto: 'tcp6', addr: '*', port: 80 }] });
svc('nginx', { desc: 'A high performance web server and a reverse proxy server', package: 'nginx', exec: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 80 }, { proto: 'tcp6', addr: '[::]', port: 80 }] });
svc('smbd', { desc: 'Samba SMB Daemon', package: 'samba', exec: '/usr/sbin/smbd --foreground --no-process-group', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 445 }, { proto: 'tcp', addr: '0.0.0.0', port: 139 }] });
svc('nmbd', { desc: 'Samba NMB Daemon', package: 'samba', exec: '/usr/sbin/nmbd --foreground --no-process-group', listen: [{ proto: 'udp', addr: '0.0.0.0', port: 137 }, { proto: 'udp', addr: '0.0.0.0', port: 138 }] });
svc('named', { desc: 'BIND Domain Name Server', package: 'bind9', user: 'bind', exec: '/usr/sbin/named -f -u bind', listen: [{ proto: 'tcp', addr: '127.0.0.1', port: 53 }, { proto: 'udp', addr: '127.0.0.1', port: 53 }] });
svc('snmpd', { desc: 'Simple Network Management Protocol (SNMP) Daemon.', package: 'snmpd', user: 'Debian-snmp', exec: '/usr/sbin/snmpd -LOw -u Debian-snmp -g Debian-snmp -I -smux mteTrigger mteTriggerConf -f', listen: [{ proto: 'udp', addr: '127.0.0.1', port: 161 }] });
svc('postfix', { desc: 'Postfix Mail Transport Agent', package: 'postfix', exec: '/usr/lib/postfix/sbin/master -w', listen: [{ proto: 'tcp', addr: '127.0.0.1', port: 25 }] });
svc('fail2ban', { desc: 'Fail2Ban Service', package: 'fail2ban', exec: '/usr/bin/python3 /usr/bin/fail2ban-server -xf start' });
svc('auditd', { desc: 'Security Auditing Service', package: 'auditd', exec: '/sbin/auditd' });
svc('nfs-server', { desc: 'NFS server and services', package: 'nfs-kernel-server', type: 'oneshot', exec: '/usr/sbin/exportfs -r', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 2049 }] });
svc('telnetd', { desc: 'Telnet server', package: 'inetutils-telnetd', exec: '/usr/sbin/telnetd', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 23 }] });

export const packageList = () => Object.values(PACKAGES);
export const serviceList = () => Object.values(SERVICES);
export const servicesOfPackage = (p) => (PACKAGES[p]?.svc || []).map((n) => SERVICES[n]).filter(Boolean);
