// Word pools for randomly generated rounds. Usernames follow the CyberPatriot style: first initial + last name.
export const FIRST = ['Aaron', 'Abby', 'Adrian', 'Aisha', 'Alan', 'Amir', 'Ana', 'Ben', 'Bianca', 'Brian', 'Caleb', 'Carmen', 'Chloe', 'Colin', 'Dana', 'Daniel', 'Deepa', 'Derek', 'Diana', 'Eli', 'Elena', 'Emma', 'Erik', 'Fatima', 'Felix', 'Grace', 'Hana', 'Hector', 'Ian', 'Imani', 'Isaac', 'Jack', 'Jada', 'James', 'Jenna', 'Jorge', 'Julia', 'Kai', 'Karen', 'Kevin', 'Laila', 'Leo', 'Lucy', 'Luis', 'Maya', 'Marcus', 'Mei', 'Mila', 'Nadia', 'Nate', 'Nina', 'Omar', 'Owen', 'Paige', 'Priya', 'Quinn', 'Rafael', 'Riley', 'Rosa', 'Ryan', 'Sam', 'Sara', 'Sean', 'Sofia', 'Tariq', 'Tessa', 'Theo', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zane', 'Zoe'];
export const LAST = ['Abbott', 'Alvarez', 'Bennett', 'Brooks', 'Carver', 'Chen', 'Collins', 'Darby', 'Dennis', 'Diaz', 'Ellis', 'Fischer', 'Foster', 'Gallo', 'Garcia', 'Gordon', 'Hardman', 'Hayes', 'Holt', 'Hughes', 'Ibarra', 'Jensen', 'Kaur', 'Kirkwood', 'Klein', 'Lambert', 'Litt', 'Lopez', 'Mason', 'Moreno', 'Murphy', 'Nash', 'Novak', 'Okafor', 'Ortiz', 'Patel', 'Paulsen', 'Pierce', 'Quinlan', 'Ramos', 'Reyes', 'Rhodes', 'Ross', 'Sato', 'Scott', 'Shah', 'Shields', 'Singh', 'Stone', 'Tanner', 'Torres', 'Vance', 'Walsh', 'Webb', 'Wolf', 'Young', 'Zimmer'];
export const ORGS = [
  ['Apex Robotics', 'a small engineering firm', 'the operations team'],
  ['Harbor Lane Library', 'a small branch library', 'the front-desk staff'],
  ['Northwind Clinic', 'a community health clinic (no patient data is stored on this machine)', 'the front office'],
  ['Summit Credit Union', 'a local credit union branch', 'the loan officers'],
  ['Bluefield High School', 'a public high school', 'the guidance office'],
  ['Cedar Ridge Architects', 'an architecture studio', 'the design team'],
  ['Lakeside Animal Shelter', 'a non-profit animal shelter', 'the volunteers'],
  ['Orbit Games Studio', 'an independent game studio', 'the QA team'],
  ['Riverbend Town Hall', 'a small town government office', 'the clerks'],
  ['Pinecrest Logistics', 'a regional shipping company', 'the dispatch desk'],
];
export const STRONG = ['Quartz&River77', 'Bl@ckHorse!42', 'Casey$Park2026', 'Sunfl0wer!Day', 'M0untain#Echo9', 'Tw1light~Fox55', 'Gr@nite-Owl31', 'C0balt!Harbor8', 'Ember^Lake2047', 'S1lver$Pine73', 'N0rth*Star606', 'Velvet#Ri5er', 'Ast3r!Cloud99', 'Ir0n&Maple14', 'Ol1ve#Comet28', 'Saff1re!Trail6', 'Copp3r~Wave81', 'Jun1per@Gate5', 'Lun@rMoss417', 'R0wan!Field62'];
export const WEAK = (u) => [u, `${u}123`, 'password', 'Password1', '123456', 'qwerty', 'letmein', 'welcome', `${u}2026`, 'changeme', 'abc123'];
export const WORDS = ['PINEAPPLE', 'BLUEBIRD', 'LIGHTHOUSE', 'CANYON', 'MAPLE', 'GRANITE', 'FALCON', 'HARBOR', 'COMET', 'TUNDRA', 'ORCHID', 'VOLCANO', 'MERIDIAN', 'SAPPHIRE'];
export const SERVICES_FOR_NOTES = ['FTP', 'VPN', 'payroll', 'staff Wi-Fi', 'backup', 'printer admin'];
export const GROUPS = ['engineering', 'finance', 'marketing', 'research', 'support', 'design', 'sales', 'outreach'];
export const HIDDEN_ROOT = ['toor', 'sysbackup', 'svc_admin', 'maint', 'rootbak', 'admin2'];
export const PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337];
