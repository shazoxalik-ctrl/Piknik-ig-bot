export const PRODUCTS = [
  { uz: "Xavoli chodir 2-3 kishi", ru: "Navesli palatka 2-3 kishi", price: "2 200 000 som" },
  { uz: "Soyabonli katta kemping palatka", ru: "Katta kemping palatka", price: "2 600 000 som" },
  { uz: "Puflama palatka sargish (daryo uchun)", ru: "Puflama palatka sariq", price: "1 750 000 som" },
  { uz: "Harbiy uslub palatka + soyabon", ru: "Harbiy palatka + soyabon", price: "2 600 000 som" },
  { uz: "Katta oq palatka 7.5m2 (oynali)", ru: "Katta oq palatka 7.5m2", price: "3 300 000 som" },
  { uz: "Katta puflama palatka 1-4 kishi", ru: "Bolshaya naduvnaya palatka", price: "2 600 000 som" },
  { uz: "Piknik kemping palatka", ru: "Piknik kemping palatka", price: "1 750 000 som" },
  { uz: "Puflama palatka 2-3 kishi", ru: "Naduvnaya palatka 2-3 kishi", price: "2 200 000 som" },
  { uz: "Yigma karavot", ru: "Skladnaya krovat", price: "635 000 som" },
  { uz: "Yigma raskladushka", ru: "Skladnaya raskladushka", price: "900 000 som" },
  { uz: "Sayohat karavoti", ru: "Turisticheskaya krovat", price: "600 000 som" },
  { uz: "Daladagi yotoq joyi", ru: "Polevoe spalnoe mesto", price: "550 000 som" },
  { uz: "Turistlar uchun karavot", ru: "Krovat dlya turistov", price: "600 000 som" },
  { uz: "Buklama kemping stuli qora", ru: "Skladnoy stul chernyy", price: "145 000 som" },
  { uz: "Mustahkam SU01 stul", ru: "Prochnyy stul SU01", price: "180 000 som" },
  { uz: "Yumshoq toshakchalik turist kreslo", ru: "Kreslo s myagkoy podushkoy", price: "250 000 som" },
  { uz: "Bej yumshoq kreslo (stakan tutgich)", ru: "Bezhevoe myagkoe kreslo", price: "225 000 som" },
  { uz: "Yashil sallangich kreslo premium", ru: "Zelenoe kreslo-kachalka", price: "500 000 som" },
  { uz: "Quyoshdan himoya panama", ru: "Panama ot solntsa", price: "170 000 som" },
];

export function catalogText() {
  return PRODUCTS.map((p) => `- ${p.uz} — ${p.price}`).join("\n");
}
