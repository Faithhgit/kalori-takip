# Kalori ve Makro Takip

HTML/CSS/Vanilla JS ile gelistirilmis, Firebase Firestore kullanan kalori ve makro takip uygulamasi.

## Ozellikler

- Gunluk kalori ve makro takibi (protein, karbonhidrat, yag)
- Son 7 gun grafik ve motivasyon mesaji
- Profil bilgisine gore hedef hesaplama (BMR/TDEE)
- Kilo takibi ve adaptive TDEE yardimi
- Ozellestirilebilir urun veritabani
- Tum Urunler sekmesi (yiyecek/icecek filtre + arama)
- Sablonlar sekmesi (sablon olustur, uygula, sil)
- Dark/Light mode ve mobil uyumlu arayuz

## Guncel Veri Sayilari

- Yiyecek: 43
- Icecek: 33
- Toplam urun: 76

## Proje Yapisi

```text
/
|-- index.html
|-- styles.css
|-- app.js
|-- firebase-config.js
|-- data/
|   |-- foods.js
|   `-- drinks.js
`-- README.md
```

## Kurulum

1. Firebase projesi olustur.
2. Firestore Database'i aktif et.
3. `firebase-config.js` dosyasina kendi Firebase bilgilerini yaz.
4. Projeyi static olarak calistir (Live Server vb.).

## Veri Modeli (daily_logs)

```js
{
  date: "YYYY-MM-DD",
  item_id: "food_001 | drink_001",
  item_name: "Urun Adi",
  grams: 150,
  kcal: 250,
  protein: 30,
  carb: 15,
  fat: 8,
  created_at: Timestamp
}
```

## Notlar

- `data/foods.js` ve `data/drinks.js` dosyalari read-only kaynak listelerdir.
- Yeni urun eklemek icin benzersiz `id` kullanin.
- Uygulama kisisel kullanim odaklidir.
