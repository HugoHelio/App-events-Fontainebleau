const fs = require('fs');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Erreur: Clé API GEMINI_API_KEY introuvable.");
  process.exit(1);
}

async function searchEventsWithGemini() {
  const today = new Date();
  const startDateStr = today.toISOString().split('T')[0]; // Ex: "2026-09-18"
  
  // Fenêtre glissante de 4 mois
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 4);
  const endDateStr = maxDate.toISOString().split('T')[0];

  const prompt = `
Effectue une recherche web approfondie sur les événements à venir dans la région de Fontainebleau.
Nous sommes aujourd'hui le ${startDateStr}.

PÉRIODE DE RECHERCHE STRICTE :
- Conserve UNIQUEMENT les événements se déroulant entre le ${startDateStr} et le ${endDateStr}.
- Exclus tous les événements passés (finis avant le ${startDateStr}).

PÉRIMÈTRE GÉOGRAPHIQUE :
- Ville principale : Fontainebleau.
- Communes voisines (< 15 km) : Avon, Barbizon, Samois-sur-Seine, Thomery, Bois-le-Roi, Bourron-Marlotte, Moret-Loing-et-Orvanne, Nemours, Vaux-le-Vicomte, Blandy-les-Tours.

SOURCES ET SITES À EXPLORER EN PRIORITÉ :
1. Office de Tourisme du Pays de Fontainebleau (fontainebleau-tourisme.com / agenda).
2. Agendas municipaux des mairies : Fontainebleau, Avon, Barbizon, Moret-sur-Loing, Nemours.
3. Programmations des Châteaux : Château de Fontainebleau, Château de Vaux-le-Vicomte, Château de Blandy-les-Tours.
4. Plateformes d'inscriptions sportives & associatives : HelloAsso, KMS, Klikego, ProTiming.
5. Presse et magazines locaux : Le Bellifontain, La République de Seine-et-Marne.

TYPES D'ÉVÉNEMENTS À EXTRAIRE :
- Sport & Outdoor : trails en forêt, courses à pied, randos VTT, compétitions d'escalade/bouldering, critériums cyclistes, triathlons.
- Nature & Patrimoine : sorties guidées en forêt, visites botaniques, brame du cerf, animations nature.
- Culture, Famille & Loisirs : ateliers enfants, expositions, spectacles au château, brocantes, marchés du terroir, fêtes d'automne et animations de fin d'année.

INSTRUCTIONS DE FORMATAGE ET COORDONNÉES GPS :
- Indique les coordonnées latitude (lat) et longitude (lng) précises du lieu.
- Choisis "category" UNIQUEMENT parmi ces trois choix : "Sport & Outdoor", "Nature & Environnement", "Culture & Ateliers".

Renvoie UNIQUEMENT un tableau JSON strict au format exact suivant :
[
  {
    "title": "Titre explicite de l'événement",
    "category": "Sport & Outdoor" | "Nature & Environnement" | "Culture & Ateliers",
    "ageMin": 0,
    "ageMax": 99,
    "city": "Nom de la ville",
    "locationName": "Lieu précis (ex: Grand Parquet, Parc du Château, Forêt domaniale)",
    "lat": 48.4020,
    "lng": 2.7010,
    "dateType": "event",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "schedule": "Horaires précis (ex: Samedi de 10h à 18h)",
    "price": "Gratuit ou tarif exact",
    "organizer": "Nom de l'association, mairie ou lieu",
    "description": "Courte description synthétique et attrayante",
    "url": "URL source directe de l'événement"
  }
]
`;

  const apiUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  apiUrl.searchParams.append("key", GEMINI_API_KEY);

  const requestData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [
      { google_search: {} }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(`Erreur HTTP ${res.statusCode} : ${body}`);
        }
        try {
          const response = JSON.parse(body);

          const candidate = response.candidates && response.candidates[0];
          if (!candidate) {
            return reject("Aucun candidat retourné dans la réponse API.");
          }

          let rawText = "";
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) rawText += part.text;
            }
          }

          if (!rawText) {
            return reject(`Aucun texte généré. FinishReason: ${candidate.finishReason}`);
          }

          const jsonMatch = rawText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            return reject("Impossible de localiser un tableau JSON dans la réponse.");
          }

          const cleanJson = jsonMatch[0].trim();
          resolve(JSON.parse(cleanJson));

        } catch (e) {
          reject("Erreur parsing JSON : " + e.message + "\nRéponse brute : " + body);
        }
      });
    });

    req.on('error', reject);
    req.write(requestData);
    req.end();
  });
}

async function main() {
  console.log("🚀 Démarrage du scan approfondi (+4 mois à venir)...");
  try {
    const rawEvents = await searchEventsWithGemini();
    const todayStr = new Date().toISOString().split('T')[0];

    // Filtre de sécurité Node.js : Ne garder que les événements futurs
    const validEvents = rawEvents.filter(e => {
      const eventEnd = e.endDate || e.startDate;
      return eventEnd && eventEnd >= todayStr;
    });

    console.log(`✅ ${validEvents.length} événements futurs identifiés sur le web.`);

    const existingDataPath = './data.json';
    let existingData = [];
    if (fs.existsSync(existingDataPath)) {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf8'));
    }

    const updatedData = [...existingData];

    validEvents.forEach(newEvent => {
      // Détection des doublons sur le titre
      const index = updatedData.findIndex(e => e.title && e.title.trim().toLowerCase() === newEvent.title.trim().toLowerCase());

      // Validation / Fallback des coordonnées GPS
      const lat = parseFloat(newEvent.lat) || 48.4020;
      const lng = parseFloat(newEvent.lng) || 2.7010;

      const cleanEvent = {
        ...newEvent,
        lat,
        lng,
        startDate: newEvent.startDate || todayStr,
        endDate: newEvent.endDate || newEvent.startDate || todayStr
      };

      if (index !== -1) {
        // Mise à jour en conservant l'ID existant
        const originalId = updatedData[index].id;
        updatedData[index] = { ...updatedData[index], ...cleanEvent, id: originalId };
      } else {
        // Génération d'un nouvel identifiant
        cleanEvent.id = `ACT_${String(updatedData.length + 1).padStart(3, '0')}`;
        updatedData.push(cleanEvent);
      }
    });

    fs.writeFileSync(existingDataPath, JSON.stringify(updatedData, null, 2));
    console.log(`💾 Base data.json mise à jour avec succès ! Total : ${updatedData.length} activités.`);

  } catch (err) {
    console.error("❌ Erreur lors du scan :", err);
    process.exit(1);
  }
}

main();