# Tarjama

Prevod arapskih knjiga na bosanski, rečenicu po rečenicu, do gotove knjige.

## Kako se koristi

1. Otvori aplikaciju u **Chromeu ili Edgeu** (Firefox ne može snimati projekat u fajl).
2. Klikni **AI** gore desno, izaberi servis (Claude, ChatGPT, Gemini ili neki drugi), zalijepi svoj API ključ i klikni **Provjeri ključ**.
3. **Nova knjiga iz PDF-a**: izaberi arapski PDF. Aplikacija pokaže jednu stranicu i tekst koji je iz nje pročitala:
   - ako je tekst isti kao na slici, koristi se taj tekst (brže i jeftinije);
   - ako nije, ili je knjiga skenirana, AI čita svaku stranicu sa slike.
4. Izaberi gdje da se projekat sačuva (npr. `Dokumenti\Prevodi\Knjiga.tarjama`). Od tada se svaka promjena sama snima u taj fajl.
5. **Počni prevod**. Prevodi se po dvije strane. Možeš zaustaviti i nastaviti kad hoćeš.
6. Ispravke: klikni na bosansku rečenicu, ispravi, pa Enter. Fusnota: označi riječ mišem i klikni **Dodaj fusnotu**.
7. **Izvoz knjige**: PDF (naslovna strana, sadržaj, brojevi stranica, fusnote na dnu stranice), Word (.docx) ili običan tekst.

Ključ i knjige ostaju samo na tvom računaru. Prevod ide direktno od tebe do AI servisa koji izabereš i plaća se na tvom računu kod tog servisa.

U **Pravila prevoda** upisuješ kako da AI prevodi određene izraze (npr. عز وجل → „Uzvišeni“).

## Za programera

```
npm install
npm run dev
```

`npm run build` pravi statičku stranicu u `dist/`, spremnu za GitHub Pages. Paged.js (MIT) je kopiran u `public/vendor/`.
