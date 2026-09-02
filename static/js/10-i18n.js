"use strict";

  /* =========================================================
     TIL ALMASHTIRISH
  ==========================================================*/
  var t = {
    UZ:{sotuv:"Sotuv", ijara:"Ijara", kunlik:"Kunlik", search:"Qidirish... (nomi, hudud)", post_ad:"E'lon joylash", admin:"Admin", on_map:"Xaritada", filters:"Filtrlar", type_all:"Barcha turlar", kvartira:"Kvartira", hovli:"Hovli/dacha", tijorat:"Tijorat binolari", yer:"Yer", owner:"Egasi", mortgage:"Ipotekaga mumkin", last_week:"Oxirgi hafta", last_month:"Oxirgi oy",
      desc:"Tavsif", posted_by:"Kim joylashtirdi", property_type:"Mulk turi", rooms_count:"Xonalar soni", area_label:"Maydon, m²", repair_label:"Ta'mir", location:"Joylashuv", show_route:"Yo'nalishni ko'rsatish", msg_seller:"Sotuvchiga yozing", call_seller:"Qo'ng'iroq qilish", view_profile:"Profilni ko'rish", floor_label:"Qavat", floors_total_label:"Uyning qavatlari soni",
      hero_eyebrow:"To'g'ridan-to'g'ri egasidan, tekshirilgan e'lonlar", hero_title_1:"Uyingiz bor.", hero_title_2:"Topilishi", hero_title_em:"qoldi.", hero_sub:"Jizzax viloyati bo'ylab kvartira, hovli, tijorat binosi va yer e'lonlari — bitta manzilda. Admin tomonidan tasdiqlangan, ishonchli sotuvchilardan.", hero_browse:"E'lonlarni ko'rish", hero_stat_listings:"Faol e'lon", hero_stat_districts:"Tuman qamrovi", hero_chip:"Admin tasdiqlagan"},
    RU:{sotuv:"Продажа", ijara:"Аренда", kunlik:"Посуточно", search:"Поиск... (название, район)", post_ad:"Разместить объявление", admin:"Админ", on_map:"На карте", filters:"Фильтры", type_all:"Все типы", kvartira:"Квартира", hovli:"Дом/дача", tijorat:"Коммерческая", yer:"Земля", owner:"От собственника", mortgage:"Ипотека возможна", last_week:"За неделю", last_month:"За месяц",
      desc:"Описание", posted_by:"Кто разместил", property_type:"Тип недвижимости", rooms_count:"Количество комнат", area_label:"Площадь, м²", repair_label:"Ремонт", location:"Расположение", show_route:"Показать маршрут", msg_seller:"Написать продавцу", call_seller:"Позвонить", view_profile:"Смотреть профиль", floor_label:"Этаж", floors_total_label:"Этажность дома",
      hero_eyebrow:"Напрямую от собственника, проверенные объявления", hero_title_1:"Ваш дом есть.", hero_title_2:"Осталось", hero_title_em:"найти его.", hero_sub:"Квартиры, дома, коммерческая недвижимость и земля по всей Джизакской области — в одном месте. Проверено администрацией, от надёжных продавцов.", hero_browse:"Смотреть объявления", hero_stat_listings:"Активных объявлений", hero_stat_districts:"Районов охвачено", hero_chip:"Подтверждено админом"},
    EN:{sotuv:"Sale", ijara:"Rent", kunlik:"Daily", search:"Search... (title, district)", post_ad:"Post an ad", admin:"Admin", on_map:"On map", filters:"Filters", type_all:"All types", kvartira:"Apartment", hovli:"House/dacha", tijorat:"Commercial", yer:"Land", owner:"By owner", mortgage:"Mortgage OK", last_week:"Last week", last_month:"Last month",
      desc:"Description", posted_by:"Posted by", property_type:"Property type", rooms_count:"Rooms", area_label:"Area, m²", repair_label:"Renovation", location:"Location", show_route:"Show route", msg_seller:"Message seller", call_seller:"Call", view_profile:"View profile", floor_label:"Floor", floors_total_label:"Total floors",
      hero_eyebrow:"Straight from the owner, verified listings", hero_title_1:"Your home is out there.", hero_title_2:"Finding it is", hero_title_em:"the easy part.", hero_sub:"Apartments, houses, commercial spaces and land across Jizzax region — all in one place. Admin-verified, from trusted sellers.", hero_browse:"Browse listings", hero_stat_listings:"Active listings", hero_stat_districts:"Districts covered", hero_chip:"Admin verified"}
  };
  // listings themselves are stored in Uzbek (type/district/repair/
  // condition are fixed enum-like values, not free text) - this maps
  // those exact Uzbek strings to RU/EN so a listing's own words also
  // switch with the language picker, not just the surrounding UI chrome.
  var TYPE_TO_DICT_KEY = {'Kvartira':'kvartira', 'Hovli/dacha':'hovli', 'Tijorat binolari':'tijorat', 'Yer':'yer'};
  var VALUE_TRANSLATIONS = {
    'Jizzax shahri': {RU:'г. Джизак', EN:'Jizzax city'},
    'Arnasoy tumani': {RU:'Арнасайский район', EN:'Arnasoy district'},
    'Baxmal tumani': {RU:'Бахмальский район', EN:'Baxmal district'},
    "Do'stlik tumani": {RU:'Дустликский район', EN:"Do'stlik district"},
    'Forish tumani': {RU:'Форишский район', EN:'Forish district'},
    "G'allaorol tumani": {RU:'Галляаральский район', EN:"G'allaorol district"},
    "Mirzacho'l tumani": {RU:'Мирзачульский район', EN:"Mirzacho'l district"},
    'Paxtakor tumani': {RU:'Пахтакорский район', EN:'Paxtakor district'},
    'Sh. Rashidov tumani': {RU:'р-н Ш. Рашидова', EN:'Sh. Rashidov district'},
    'Yangiobod tumani': {RU:'Янгиабадский район', EN:'Yangiobod district'},
    'Zafarobod tumani': {RU:'Зафарабадский район', EN:'Zafarobod district'},
    'Zarbdor tumani': {RU:'Зарбдарский район', EN:'Zarbdor district'},
    'Zomin tumani': {RU:'Зааминский район', EN:'Zomin district'},
    'Evroremont': {RU:'Евроремонт', EN:'Euro renovation'},
    "O'rtacha": {RU:'Средний', EN:'Average'},
    "Ta'mirsiz": {RU:'Без ремонта', EN:'No renovation'},
    "Ikkinchi qo'l": {RU:'Вторичка', EN:'Second-hand'},
    'Yangi bino': {RU:'Новостройка', EN:'New building'},
    'Uy egasi': {RU:'Собственник', EN:'Owner'},
    'Xaridor': {RU:'Покупатель', EN:'Buyer'},
    'Ishonchli sotuvchi': {RU:'Надёжный продавец', EN:'Trusted seller'}
  };
  function trValue(uzText){
    if(currentLang === 'UZ' || !uzText) return uzText;
    var typeKey = TYPE_TO_DICT_KEY[uzText];
    if(typeKey) return t[currentLang][typeKey];
    var entry = VALUE_TRANSLATIONS[uzText];
    return (entry && entry[currentLang]) || uzText;
  }
  function applyLang(lang){
    currentLang = lang;
    document.getElementById('langCode').textContent = lang;
    var dict = t[lang];
    document.querySelectorAll('#segment button[data-deal]').forEach(function(b){ b.textContent = dict[b.getAttribute('data-deal')]; });
    document.getElementById('searchInput').setAttribute('placeholder', dict.search);
    // Both buttons have a leading text node + a trailing arrow-icon
    // <span> (see .cta-arrow) - touch only the text node, or .textContent
    // would wipe the icon out.
    document.getElementById('heroEyebrowText').textContent = dict.hero_eyebrow;
    document.getElementById('heroTitle1').textContent = dict.hero_title_1;
    document.getElementById('heroTitle2').textContent = dict.hero_title_2;
    document.getElementById('heroTitleEm').textContent = dict.hero_title_em;
    document.getElementById('heroSub').textContent = dict.hero_sub;
    document.getElementById('heroBrowseBtn').textContent = dict.hero_browse;
    document.getElementById('heroStatListingsLabel').textContent = dict.hero_stat_listings;
    document.getElementById('heroStatDistrictsLabel').textContent = dict.hero_stat_districts;
    document.getElementById('heroChipText').textContent = dict.hero_chip;
    ['postAdBtn', 'heroPostBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if(btn && btn.firstChild) btn.firstChild.textContent = dict.post_ad;
    });
    document.querySelector('#mapBtn').childNodes[1] ? (document.querySelector('#mapBtn').lastChild.textContent = dict.on_map) : null;
    document.querySelector('#filtersBtn').lastChild.textContent = ' ' + dict.filters;
    if(filterState.type === 'all'){ document.getElementById('typeLabel').textContent = dict.type_all; }
    var typeMap = {all:dict.type_all, kvartira:dict.kvartira, hovli:dict.hovli, tijorat:dict.tijorat, yer:dict.yer};
    document.querySelectorAll('#typeDropdown button').forEach(function(b){ b.textContent = typeMap[b.getAttribute('data-type')]; });
    document.querySelector('[data-filter="owner"]').lastChild.textContent = ' ' + dict.owner;
    document.querySelector('[data-filter="mortgage"]').lastChild.textContent = ' ' + dict.mortgage;
    document.querySelector('[data-filter="lastWeek"]').lastChild.textContent = ' ' + dict.last_week;
    document.querySelector('[data-filter="lastMonth"]').lastChild.textContent = ' ' + dict.last_month;
    // The listing chrome above is UI-only, but each listing's own words
    // (type/district/repair) are stored in Uzbek - re-render whatever's
    // currently on screen so switching language actually retranslates
    // them too, not just the surrounding buttons/labels.
    renderPublic();
    if(currentDetailListing && document.getElementById('pageDetail').classList.contains('show')){
      openDetail(currentDetailListing.id, currentDetailListing.fromAdmin, true);
    }
  }

