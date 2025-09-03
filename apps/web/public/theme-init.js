/* Early theme and language setup to avoid FOUC */
(function(){try{var k='theme';var s=localStorage.getItem(k);var map={oled:'dark',white:'light'};var t=map[s]||s||'dark';document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t==='dark'?'dark':'light';}catch(e){}
 try{var lk='lang';var l=localStorage.getItem(lk)||'en';document.documentElement.setAttribute('lang',l);document.documentElement.setAttribute('data-lang',l);}catch(e){}})();

