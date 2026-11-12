"""
Public legal pages: offer, privacy policy and how payment works. They live at
their own URLs (/oferta/, /maxfiylik/, /tolov/) because payment providers ask
for these pages on the site before they connect a merchant.

The seller's details come from settings (LEGAL_* env vars); a line is shown
only when it is filled in.
"""
from django.conf import settings
from django.shortcuts import render

from .models import TIER_LIFECYCLE

PHONES = ['+998 50 179 52 82', '+998 99 093 24 01']
CARDS = ['VISA', 'Mastercard', 'HUMO', 'UZCARD']


def _seller():
    rows = [
        ('Xizmat ko\'rsatuvchi', settings.LEGAL_SELLER_NAME),
        ('STIR / JShShIR', settings.LEGAL_SELLER_ID),
        ('Manzil', settings.LEGAL_ADDRESS),
        ('Telefon', ', '.join(PHONES)),
        ('Email', settings.LEGAL_EMAIL),
        ('Telegram', '@joyjizzax'),
        ('Sayt', settings.SITE_BASE_URL),
    ]
    return [(label, value) for label, value in rows if value]


def _days(tier, stage):
    for name, days in TIER_LIFECYCLE[tier]:
        if name == stage:
            return days
    return 0


def _page(request, title, sections, show_cards=False):
    return render(request, 'legal.html', {
        'title': title, 'sections': sections, 'seller': _seller(), 'cards': CARDS if show_cards else [],
    })


def offer_page(request):
    top, vip = settings.LISTING_PRICE_UZS['top'], settings.LISTING_PRICE_UZS['vip']
    fmt = lambda n: f'{n:,}'.replace(',', ' ')
    sections = [
        ('1. Umumiy qoidalar', [
            "Ushbu hujjat Jizzax-Joy veb-saytida (jizzax-joy.uz) xizmatlardan foydalanish shartlarini belgilaydi va O'zbekiston "
            "Respublikasi qonunchiligiga muvofiq ommaviy taklif (oferta) hisoblanadi.",
            "Saytdan foydalanish yoki to'lovni amalga oshirish ushbu shartlarga to'liq rozilikni bildiradi.",
        ]),
        ('2. Xizmat predmeti', [
            "Jizzax-Joy — Jizzax viloyati bo'ylab ko'chmas mulk (kvartira, hovli, tijorat binosi, yer) e'lonlarini joylashtirish va qidirish uchun axborot platformasi.",
            "Oddiy e'lon joylash — bepul.",
            "TOP va VIP — pullik reklama xizmati: e'lon sayt ro'yxatida yuqori o'rinlarda ko'rsatiladi va ajralib turadigan belgi oladi.",
        ]),
        ('3. Xizmat narxlari', [
            f"TOP e'lon: {fmt(top)} so'm (bir marta joylash uchun, e'lon {_days('top', 'top')} kun TOP'da turadi).",
            f"VIP e'lon: {fmt(vip)} so'm (bir marta joylash uchun, e'lon {_days('vip', 'vip')} kun VIP'da turadi).",
            "Narxlar so'mda ko'rsatilgan. Alohida chegirmalar foydalanuvchiga xabar orqali beriladi va to'lov oldidan narxda ko'rinadi.",
        ]),
        ('4. To\'lov tartibi', [
            "To'lov Visa, Mastercard, Humo va Uzcard bank kartalari orqali amalga oshiriladi. To'lov tartibi batafsil «To'lov tartibi» sahifasida yozilgan.",
            "Karta ma'lumotlari saytimizda kiritilmaydi va saqlanmaydi: ular litsenziyalangan to'lov tashkilotining xavfsiz sahifasida kiritiladi.",
            "To'lov muvaffaqiyatli tasdiqlangach xizmat avtomatik faollashadi (odatda bir necha daqiqa ichida).",
        ]),
        ('5. Pulni qaytarish', [
            "To'lov qilingan, ammo xizmat bizning aybimiz bilan ko'rsatilmagan hollarda (masalan, TOP/VIP faollashmagan) foydalanuvchi pulni qaytarishni so'rashi mumkin.",
            "So'rov ushbu sahifa pastidagi aloqa ma'lumotlari orqali, to'lov sanasidan boshlab 7 kun ichida yuboriladi. Ko'rib chiqilgach pul to'lov qilingan kartaga qaytariladi; bank muddati to'lov tashkiloti va bankka bog'liq.",
            "Xizmat to'liq ko'rsatilgan bo'lsa, e'lon foydalanuvchi tomonidan o'chirilgan yoki sotilgan deb belgilangan bo'lsa, to'lov qaytarilmaydi.",
        ]),
        ('6. Foydalanuvchi majburiyatlari', [
            "Foydalanuvchi joylashtirgan e'lon ma'lumotlarining (narx, maydon, manzil, rasm, aloqa) haqiqiyligi uchun o'zi javob beradi.",
            "Boshqa shaxsning mulkini uning roziligisiz e'lon qilish, aldamchi yoki qonunga zid ma'lumot joylash taqiqlanadi.",
            "Jizzax-Joy qoidalarni buzgan e'lonlarni ogohlantirishsiz o'chirish va foydalanuvchini cheklash huquqini saqlab qoladi.",
        ]),
        ('7. Javobgarlik', [
            "Jizzax-Joy axborot platformasi bo'lib, foydalanuvchilar o'rtasidagi oldi-sotdi yoki ijara bitimlarining tomoni emas va ularning bajarilishi uchun javobgar emas.",
            "Foydalanuvchilar bitim oldidan ma'lumot va hujjatlarni mustaqil tekshirishlari tavsiya etiladi.",
        ]),
        ('8. Nizolarni hal qilish', [
            "Nizolar avvalo muzokaralar orqali hal qilinadi. Kelishuvga erishilmasa, O'zbekiston Respublikasi qonunchiligiga muvofiq sud orqali ko'riladi.",
        ]),
    ]
    return _page(request, 'Ommaviy oferta', sections)


def privacy_page(request):
    sections = [
        ('1. Qanday ma\'lumotlar yig\'iladi', [
            "Ro'yxatdan o'tishda: ism-familiya, telefon raqami, foydalanuvchi nomi va parol (parol faqat shifrlangan holatda saqlanadi). Google orqali kirishda — Google hisobining nomi va email manzili.",
            "E'lon joylashda: e'lon matni, narx, manzil va xarita joyi, rasmlar, ixtiyoriy ovozli izoh va e'londa ko'rsatiladigan aloqa telefoni.",
            "Foydalanish jarayonida: foydalanuvchilar orasidagi xabarlar, brauzer sozlamalari (cookie va mahalliy xotira) hamda tashriflar statistikasi.",
            "Bank kartasi ma'lumotlari (raqam, amal qilish muddati, CVV) saytimizda yig'ilmaydi va saqlanmaydi — ular to'lov tashkilotining xavfsiz sahifasida kiritiladi.",
        ]),
        ('2. Ma\'lumotlardan foydalanish maqsadi', [
            "Xizmatni ko'rsatish: hisob yaratish, e'lonlarni joylash va ko'rsatish, foydalanuvchilarni bog'lash.",
            "To'lovlarni qayta ishlash va TOP/VIP xizmatini faollashtirish.",
            "Xavfsizlik: firibgarlik va qoidabuzarliklarning oldini olish, shikoyatlarni ko'rib chiqish.",
            "Sayt ishlashini yaxshilash uchun umumiy statistika.",
        ]),
        ('3. Ma\'lumotlar kimga beriladi', [
            "E'londa ko'rsatilgan ma'lumotlar (matn, rasm, narx, aloqa telefoni) ochiq bo'lib, saytda hamda Jizzax-Joy Telegram kanali va ijtimoiy tarmoq sahifalarida e'lon sifatida ulashilishi mumkin.",
            "To'lov uchun zarur ma'lumotlar to'lov tashkilotiga uzatiladi. Saytni ishlatish uchun hosting va texnik xizmat ko'rsatuvchilar ishtirok etadi.",
            "Shaxsiy ma'lumotlar uchinchi shaxslarga sotilmaydi. Qonun talab qilgan hollarda vakolatli organlarga berilishi mumkin.",
        ]),
        ('4. Saqlash va himoya', [
            "Ma'lumotlar himoyalangan serverda saqlanadi, sayt HTTPS orqali ishlaydi. Parollar bir tomonlama shifrlangan ko'rinishda saqlanadi.",
            "Ma'lumotlar xizmat ko'rsatish uchun zarur muddat davomida yoki foydalanuvchi o'chirishni so'ragunicha saqlanadi.",
        ]),
        ('5. Foydalanuvchi huquqlari', [
            "Foydalanuvchi o'z ma'lumotlarini ko'rish, tuzatish va hisobini hamda e'lonlarini o'chirishni so'rashi mumkin.",
            "So'rovlar ushbu sahifa pastidagi aloqa ma'lumotlari orqali yuboriladi.",
        ]),
        ('6. O\'zgarishlar', [
            "Ushbu siyosat yangilanishi mumkin. Joriy tahrir doimo shu sahifada e'lon qilinadi.",
        ]),
    ]
    return _page(request, 'Maxfiylik siyosati', sections)


def payment_info_page(request):
    top, vip = settings.LISTING_PRICE_UZS['top'], settings.LISTING_PRICE_UZS['vip']
    fmt = lambda n: f'{n:,}'.replace(',', ' ')
    sections = [
        ('Nima uchun to\'lanadi', [
            "Oddiy e'lon joylash bepul. Pul faqat TOP va VIP reklama xizmati uchun olinadi — e'lon ro'yxatda yuqorida ko'rsatiladi.",
            f"TOP — {fmt(top)} so'm, VIP — {fmt(vip)} so'm (bir marta joylash uchun).",
        ]),
        ('Qanday to\'lanadi', [
            "1. E'lon joylash sahifasida TOP yoki VIP'ni tanlang.",
            "2. «To'lov qilish» tugmasini bosing — to'lov tashkilotining xavfsiz sahifasi ochiladi.",
            "3. Bank kartangiz ma'lumotlarini o'sha sahifada kiriting va to'lovni tasdiqlang.",
            "4. To'lov o'tgach saytga qaytasiz, e'loningiz tanlangan turda avtomatik faollashadi.",
        ]),
        ('Qabul qilinadigan kartalar', [
            "Visa, Mastercard, Humo va Uzcard. Barcha to'lovlar so'mda amalga oshiriladi.",
        ]),
        ('Xavfsizlik', [
            "Karta ma'lumotlari Jizzax-Joy saytiga kiritilmaydi va bizda saqlanmaydi. Ular faqat litsenziyalangan to'lov tashkilotining himoyalangan sahifasida kiritiladi.",
        ]),
        ('Xizmat qanday yetkaziladi', [
            "TOP/VIP — elektron xizmat. U to'lov tasdiqlangach darhol sayt ichida faollashadi, jismoniy yetkazib berish yo'q.",
        ]),
        ('Pulni qaytarish va savollar', [
            "Xizmat faollashmagan yoki to'lov ikki marta yechilgan bo'lsa, pastdagi aloqa ma'lumotlari orqali murojaat qiling. Qaytarish shartlari Ommaviy ofertaning 5-bo'limida yozilgan.",
        ]),
    ]
    return _page(request, "To'lov tartibi", sections, show_cards=True)
