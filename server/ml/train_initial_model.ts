import fs from 'fs';
import path from 'path';
import {
  extractTokens,
  softmax,
  type TrainedComplaintModel,
} from './modeling.ts';

interface TrainingSample {
  text: string;
  category: string;
}

export const UTILITY_CATEGORIES = [
  'Power supply interruption / meter powered but home disconnected',
  'Recharge/payment made but balance not updated',
  'Unexpected / excess / wrong deduction or billing charges',
  'App login / registration / app data / usage display',
  'Meter damaged / faulty / display / blank / not working',
  'Bill generation / high bill / billing correction',
  'Meter not communicating',
  'SMS / bill message / notification not received',
  'Meter reading / consumption / deduction not happening',
  'Load change / load increase or decrease',
  'Meter shifting / seal / replacement / wrong meter',
  'Free electricity / subsidy / free units',
  'Previous payment/arrears/incorrect payment adjustment',
  'Other / unclear / incomplete',
] as const;

const TRAINING_SAMPLES: TrainingSample[] = [
  // 1. Power supply interruption / meter powered but home disconnected
  { category: UTILITY_CATEGORIES[0], text: 'Power cut in our area since morning and no light at home.' },
  { category: UTILITY_CATEGORIES[0], text: 'Smart meter is powered on with green light but home electricity supply is disconnected.' },
  { category: UTILITY_CATEGORIES[0], text: 'Bijli nahi aa rahi hai subah se, supply band hai pure mohalle mein.' },
  { category: UTILITY_CATEGORIES[0], text: 'Meter me light jal rahi hai par ghar ki bijli chali gayi aur supply disconnected hai.' },
  { category: UTILITY_CATEGORIES[0], text: 'Overhead wire snapped near electric pole and transformer phase is off.' },
  { category: UTILITY_CATEGORIES[0], text: 'Line fault on feeder caused frequent power outage and no electricity supply.' },
  { category: UTILITY_CATEGORIES[0], text: 'Cable fault and pole wire broken outside house, no electricity since yesterday.' },
  { category: UTILITY_CATEGORIES[0], text: 'New connection approved but pole installation pending and wire connection pending.' },
  { category: UTILITY_CATEGORIES[0], text: 'Light nhi aa rahi ghar me supply bnd hai please restore power.' },
  { category: UTILITY_CATEGORIES[0], text: 'Phase off ho gaya hai transformer fuse ud gaya hai bijali nahi hai.' },
  { category: UTILITY_CATEGORIES[0], text: 'बिजली नहीं आ रही है घर में सप्लाई बंद है मीटर चालू है।' },
  { category: UTILITY_CATEGORIES[0], text: 'ट्रांसफार्मर और पोल के तार में फॉल्ट के कारण लाइट कटी हुई है।' },
  { category: UTILITY_CATEGORIES[0], text: 'फेज ऑफ होने से घर की बिजली आपूर्ति बाधित है और लाइन फॉल्ट है।' },

  // 2. Recharge/payment made but balance not updated
  { category: UTILITY_CATEGORIES[1], text: 'Prepaid recharge payment made via UPI but balance not updated in meter.' },
  { category: UTILITY_CATEGORIES[1], text: 'Recharge done online and amount deducted from bank yet not credited in meter.' },
  { category: UTILITY_CATEGORIES[1], text: 'Maine 500 rupay ka recharge kiya payment deducted ho gaya par balance update nahi hua.' },
  { category: UTILITY_CATEGORIES[1], text: 'UPI online recharge pending hai aur smart meter balance nahi badha.' },
  { category: UTILITY_CATEGORIES[1], text: 'Payment done successfully on portal but recharge token not credited to consumer account.' },
  { category: UTILITY_CATEGORIES[1], text: 'Recharge kara liya paise kat gaye par meter balance update nhi hua.' },
  { category: UTILITY_CATEGORIES[1], text: 'Online payment made twice for prepaid meter recharge still balance not updated.' },
  { category: UTILITY_CATEGORIES[1], text: 'रिचार्ज किया पैसा कट गया लेकिन मीटर में बैलेंस अपडेट नहीं हुआ।' },
  { category: UTILITY_CATEGORIES[1], text: 'यूपीआई से पेमेंट हो गया है पर अभी तक रिचार्ज अमाउंट क्रेडिट नहीं हुआ।' },
  { category: UTILITY_CATEGORIES[1], text: 'ऑनलाइन भुगतान के बाद भी बैलेंस शून्य दिखा रहा है।' },

  // 3. Unexpected / excess / wrong deduction or billing charges
  { category: UTILITY_CATEGORIES[2], text: 'Unexpected excess deduction from prepaid balance even with appliances switched off.' },
  { category: UTILITY_CATEGORIES[2], text: 'Daily deduction is abnormally high and wrong billing charges were deducted.' },
  { category: UTILITY_CATEGORIES[2], text: 'Bina wajah extra deduction ho raha hai, roz jyada paisa kat gaya balance se.' },
  { category: UTILITY_CATEGORIES[2], text: 'Wrong arrear deduction and unnecessary penalty surcharge cut from my recharge.' },
  { category: UTILITY_CATEGORIES[2], text: 'Fixed charge and surcharge deduction happened twice on the same day.' },
  { category: UTILITY_CATEGORIES[2], text: 'Roz bahut zyada paise kat rahe hai daily deduction high hai bina load ke.' },
  { category: UTILITY_CATEGORIES[2], text: 'मीटर से रोज ज्यादा पैसा कट रहा है और गलत चार्ज काट लिया गया है।' },
  { category: UTILITY_CATEGORIES[2], text: 'अचानक बैलेंस से अतिरिक्त कटौती और पेनल्टी चार्ज कट गया।' },
  { category: UTILITY_CATEGORIES[2], text: 'बिना उपयोग के भी दैनिक कटौती बहुत अधिक हो रही है।' },

  // 4. App login / registration / app data / usage display
  { category: UTILITY_CATEGORIES[3], text: 'Unable to login to smart meter mobile app because OTP verification fails.' },
  { category: UTILITY_CATEGORIES[3], text: 'Consumer number link error during app registration and usage data not showing.' },
  { category: UTILITY_CATEGORIES[3], text: 'App login nahi ho raha, OTP nahi aa raha aur app not working.' },
  { category: UTILITY_CATEGORIES[3], text: 'Mobile app mein daily usage aur balance display nahi dikha raha hai.' },
  { category: UTILITY_CATEGORIES[3], text: 'App crashes after entering consumer ID and live usage consumption is not showing.' },
  { category: UTILITY_CATEGORIES[3], text: 'Smart meter app registration failed consumer link issue and OTP expired.' },
  { category: UTILITY_CATEGORIES[3], text: 'मोबाइल ऐप लॉगिन नहीं हो रहा है और ओटीपी की समस्या आ रही है।' },
  { category: UTILITY_CATEGORIES[3], text: 'ऐप में उपभोक्ता संख्या लिंक नहीं हो रही और बैलेंस डेटा नहीं दिख रहा।' },
  { category: UTILITY_CATEGORIES[3], text: 'स्मार्ट मीटर ऐप में खपत और उपयोग विवरण प्रदर्शित नहीं हो रहा।' },

  // 5. Meter damaged / faulty / display / blank / not working
  { category: UTILITY_CATEGORIES[4], text: 'Smart meter is damaged and display screen is completely blank.' },
  { category: UTILITY_CATEGORIES[4], text: 'Meter burnt due to short circuit and MCB seal is broken.' },
  { category: UTILITY_CATEGORIES[4], text: 'Meter jal gaya hai aur screen off hai, display par kuch nahi dikh raha.' },
  { category: UTILITY_CATEGORIES[4], text: 'Meter faulty hai display blank ho gaya hai aur meter not working.' },
  { category: UTILITY_CATEGORIES[4], text: 'Sparking inside smart meter box, meter casing melted and terminal burnt.' },
  { category: UTILITY_CATEGORIES[4], text: 'Meter display off hai screen blank ho gayi aur meter kharab ho gaya.' },
  { category: UTILITY_CATEGORIES[4], text: 'स्मार्ट मीटर जल गया है और डिस्प्ले स्क्रीन पूरी तरह बंद है।' },
  { category: UTILITY_CATEGORIES[4], text: 'मीटर खराब हो गया है डिस्प्ले ब्लैंक है और कोई रीडिंग नहीं दिख रही।' },
  { category: UTILITY_CATEGORIES[4], text: 'मीटर का एमसीबी और सील टूटा हुआ है तथा उपकरण काम नहीं कर रहा।' },

  // 6. Bill generation / high bill / billing correction
  { category: UTILITY_CATEGORIES[5], text: 'Monthly electricity bill is extremely high compared to normal unit consumption.' },
  { category: UTILITY_CATEGORIES[5], text: 'Wrong average bill generated and requires billing correction and rectification.' },
  { category: UTILITY_CATEGORIES[5], text: 'Is mahine bahut high bill aaya hai, wrong bill ko rectify aur correction karein.' },
  { category: UTILITY_CATEGORIES[5], text: 'Pichle teen mahine se bill generate nahi hua hai aur average bill bhej diya.' },
  { category: UTILITY_CATEGORIES[5], text: 'Please revise incorrect electricity bill amount and issue corrected invoice.' },
  { category: UTILITY_CATEGORIES[5], text: 'Bill not generated for last two months and inflated wrong bill arrived.' },
  { category: UTILITY_CATEGORIES[5], text: 'इस महीने बिजली का बिल बहुत ज्यादा आया है कृपया बिल सुधार करें।' },
  { category: UTILITY_CATEGORIES[5], text: 'गलत औसत बिल जनरेट हुआ है बिलिंग सुधार की आवश्यकता है।' },
  { category: UTILITY_CATEGORIES[5], text: 'समय पर बिजली बिल जनरेट नहीं हो रहा है।' },

  // 7. Meter not communicating
  { category: UTILITY_CATEGORIES[6], text: 'Smart meter not communicating with server due to network communication failure.' },
  { category: UTILITY_CATEGORIES[6], text: 'Meter is offline in system and telemetry data is not syncing.' },
  { category: UTILITY_CATEGORIES[6], text: 'Meter communicate nahi kar raha hai aur offline dikha raha hai.' },
  { category: UTILITY_CATEGORIES[6], text: 'Meter offline dikha raha hai, signal network issue ke karan data sync nahi ho raha.' },
  { category: UTILITY_CATEGORIES[6], text: 'Communication failure in smart meter RF modem, meter not communicating.' },
  { category: UTILITY_CATEGORIES[6], text: 'Sim signal weak at meter location so remote server cannot communicate with meter.' },
  { category: UTILITY_CATEGORIES[6], text: 'स्मार्ट मीटर सर्वर से कम्युनिकेट नहीं कर रहा है और ऑफलाइन है।' },
  { category: UTILITY_CATEGORIES[6], text: 'नेटवर्क सिग्नल समस्या के कारण मीटर का डेटा सिंक नहीं हो रहा है।' },
  { category: UTILITY_CATEGORIES[6], text: 'मीटर में कम्युनिकेशन फेल्योर आ रहा है।' },

  // 8. SMS / bill message / notification not received
  { category: UTILITY_CATEGORIES[7], text: 'Recharge confirmation SMS and monthly bill message notifications are not received.' },
  { category: UTILITY_CATEGORIES[7], text: 'Low balance alert SMS stopped arriving on my registered mobile number.' },
  { category: UTILITY_CATEGORIES[7], text: 'Mobile par SMS nahi aata aur bill message notification band ho gaya hai.' },
  { category: UTILITY_CATEGORIES[7], text: 'Recharge aur daily balance ka SMS alert receive nahi ho raha hai.' },
  { category: UTILITY_CATEGORIES[7], text: 'Registered phone number not receiving disconnection warning notification alerts.' },
  { category: UTILITY_CATEGORIES[7], text: 'पंजीकृत मोबाइल पर बिजली बिल और बैलेंस का एसएमएस नहीं आ रहा है।' },
  { category: UTILITY_CATEGORIES[7], text: 'रिचार्ज और अलर्ट नोटिफिकेशन मैसेज प्राप्त नहीं हो रहे हैं।' },
  { category: UTILITY_CATEGORIES[7], text: 'मोबाइल नंबर पर बिल सूचना एसएमएस बंद है।' },

  // 9. Meter reading / consumption / deduction not happening
  { category: UTILITY_CATEGORIES[8], text: 'Meter reading is stuck and daily unit consumption shows zero despite load.' },
  { category: UTILITY_CATEGORIES[8], text: 'Balance and units are not deducting from smart meter for past two weeks.' },
  { category: UTILITY_CATEGORIES[8], text: 'Meter reading update nahi ho rahi aur consumption zero dikha raha hai.' },
  { category: UTILITY_CATEGORIES[8], text: 'Bijli chal rahi hai par meter mein unit aur balance deduction nahi ho raha.' },
  { category: UTILITY_CATEGORIES[8], text: 'KWH reading frozen at old figure and consumption counter is not moving.' },
  { category: UTILITY_CATEGORIES[8], text: 'मीटर की रीडिंग अपडेट नहीं हो रही है और खपत शून्य दिख रही है।' },
  { category: UTILITY_CATEGORIES[8], text: 'बिजली उपयोग के बावजूद यूनिट और बैलेंस कटौती नहीं हो रही है।' },
  { category: UTILITY_CATEGORIES[8], text: 'मीटर रीडिंग एक ही नंबर पर रुकी हुई है।' },

  // 10. Load change / load increase or decrease
  { category: UTILITY_CATEGORIES[9], text: 'Request to increase sanctioned load from 2 KW to 5 KW for new AC connection.' },
  { category: UTILITY_CATEGORIES[9], text: 'Need load decrease from 4 KW to 1 KW on my domestic electricity meter.' },
  { category: UTILITY_CATEGORIES[9], text: 'Sanction load change karwana hai 2 KW se 4 KW load increase application.' },
  { category: UTILITY_CATEGORIES[9], text: 'Ghar ka load kam karwana hai, KW load decrease request pending hai.' },
  { category: UTILITY_CATEGORIES[9], text: 'Applied for sanctioned KW load enhancement last week without update.' },
  { category: UTILITY_CATEGORIES[9], text: 'स्वीकृत लोड बढ़ाने के लिए आवेदन किया है लोड 2 किलोवाट से 5 किलोवाट करना है।' },
  { category: UTILITY_CATEGORIES[9], text: 'बिजली मीटर का लोड कम करवाना है।' },
  { category: UTILITY_CATEGORIES[9], text: 'सैंक्शन लोड परिवर्तन अनुरोध अभी तक लंबित है।' },

  // 11. Meter shifting / seal / replacement / wrong meter
  { category: UTILITY_CATEGORIES[10], text: 'Request for meter shifting to outer wall and new meter installation.' },
  { category: UTILITY_CATEGORIES[10], text: 'Wrong meter serial number mapped to my consumer ID, need meter replacement.' },
  { category: UTILITY_CATEGORIES[10], text: 'Meter shift karwana hai aur purana meter replace karke naya seal lagwana hai.' },
  { category: UTILITY_CATEGORIES[10], text: 'Wrong meter mapped hai padosi ka meter mere consumer number se juda hai.' },
  { category: UTILITY_CATEGORIES[10], text: 'Relocate electric meter outside gate and reseal meter terminal cover.' },
  { category: UTILITY_CATEGORIES[10], text: 'Smart meter replacement request pending abhi tak naya meter nahi laga.' },
  { category: UTILITY_CATEGORIES[10], text: 'मीटर शिफ्ट करवाना है और बाहर दीवार पर नया मीटर लगाना है।' },
  { category: UTILITY_CATEGORIES[10], text: 'मेरे खाते में गलत मीटर नंबर मैप हो गया है मीटर बदला जाए।' },
  { category: UTILITY_CATEGORIES[10], text: 'मीटर रिप्लेसमेंट और सील लगाने की प्रक्रिया पूरी नहीं हुई।' },

  // 12. Free electricity / subsidy / free units
  { category: UTILITY_CATEGORIES[11], text: '125 free electricity units subsidy benefit not applied to my domestic bill.' },
  { category: UTILITY_CATEGORIES[11], text: 'Government free unit scheme subsidy missing from monthly billing statement.' },
  { category: UTILITY_CATEGORIES[11], text: 'Mukhyamantri free electricity 125 unit subsidy ka labh nahi mila bill mein.' },
  { category: UTILITY_CATEGORIES[11], text: 'Free unit subsidy scheme apply karne ke baad bhi pura charge kata.' },
  { category: UTILITY_CATEGORIES[11], text: 'Eligible domestic consumer did not receive 125 unit government subsidy credit.' },
  { category: UTILITY_CATEGORIES[11], text: 'मुख्यमंत्री मुफ्त बिजली योजना की 125 यूनिट सब्सिडी नहीं मिल रही है।' },
  { category: UTILITY_CATEGORIES[11], text: 'सरकारी फ्री यूनिट सब्सिडी बिल में लागू नहीं हुई है।' },
  { category: UTILITY_CATEGORIES[11], text: 'सब्सिडी छूट के बिना पूरा बिजली शुल्क काटा गया।' },

  // 13. Previous payment/arrears/incorrect payment adjustment
  { category: UTILITY_CATEGORIES[12], text: 'Previous payment not adjusted in current bill and old arrears still showing.' },
  { category: UTILITY_CATEGORIES[12], text: 'Dues mismatch due to unadjusted old arrear balance from last year.' },
  { category: UTILITY_CATEGORIES[12], text: 'Purana arrear aur previous payment adjust nahi hua hai dues mismatch dikh raha.' },
  { category: UTILITY_CATEGORIES[12], text: 'Paid old dues before smart meter installation yet arrear adjustment is pending.' },
  { category: UTILITY_CATEGORIES[12], text: 'Incorrect payment adjustment left pending arrears on consumer ledger.' },
  { category: UTILITY_CATEGORIES[12], text: 'पिछला भुगतान वर्तमान बिल में समायोजित नहीं हुआ है पुराना बकाया दिख रहा है।' },
  { category: UTILITY_CATEGORIES[12], text: 'पुराने एरियर और बकाया राशि का मिलान गलत है समायोजन किया जाए।' },
  { category: UTILITY_CATEGORIES[12], text: 'पहले जमा की गई राशि अभी भी बकाया में दिखाई दे रही है।' },

  // 14. Other / unclear / incomplete
  { category: UTILITY_CATEGORIES[13], text: 'IVRS attached please check and call back.' },
  { category: UTILITY_CATEGORIES[13], text: 'Letter attached without issue description, consumer request unclear.' },
  { category: UTILITY_CATEGORIES[13], text: 'Complaint closed without resolution and consumer did not specify issue.' },
  { category: UTILITY_CATEGORIES[13], text: 'Incomplete complaint text with only consumer reference.' },
  { category: UTILITY_CATEGORIES[13], text: 'Sir problem hai jaldi check karein.' },
  { category: UTILITY_CATEGORIES[13], text: 'कृपया मेरी शिकायत की जांच करें और कॉल करें।' },
  { category: UTILITY_CATEGORIES[13], text: 'अस्पष्ट विवरण कृपया संपर्क करें।' },
];

export function trainAndSaveModel(outputPath: string): TrainedComplaintModel {
  const categories = [...UTILITY_CATEGORIES];
  const docTokens = TRAINING_SAMPLES.map((s) => extractTokens(s.text));

  const df = new Map<string, number>();
  for (const toks of docTokens) {
    const uniq = new Set(toks);
    for (const t of uniq) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const vocabTerms = Array.from(df.keys()).sort();
  const vocabulary: Record<string, number> = {};
  vocabTerms.forEach((t, i) => {
    vocabulary[t] = i;
  });

  const nDocs = TRAINING_SAMPLES.length;
  const vocabSize = vocabTerms.length;
  const idf = vocabTerms.map(
    (t) => Math.log((nDocs + 1) / ((df.get(t) || 0) + 1)) + 1
  );

  const X: number[][] = docTokens.map((toks) => {
    const vec = new Array<number>(vocabSize).fill(0);
    const counts = new Map<number, number>();
    for (const tok of toks) {
      const idx = vocabulary[tok];
      if (idx !== undefined) counts.set(idx, (counts.get(idx) || 0) + 1);
    }
    let normSq = 0;
    for (const [idx, c] of counts.entries()) {
      const val = (1 + Math.log(c)) * idf[idx];
      vec[idx] = val;
      normSq += val * val;
    }
    if (normSq > 0) {
      const norm = Math.sqrt(normSq);
      for (let i = 0; i < vocabSize; i++) vec[i] /= norm;
    }
    return vec;
  });

  const y = TRAINING_SAMPLES.map((s) =>
    categories.indexOf(s.category as (typeof UTILITY_CATEGORIES)[number])
  );
  const numClasses = categories.length;

  const weights: number[][] = Array.from({ length: numClasses }, () =>
    new Array<number>(vocabSize).fill(0)
  );
  const biases: number[] = new Array<number>(numClasses).fill(0);

  const lr = 0.85;
  const reg = 0.0015;
  const epochs = 340;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = Array.from({ length: numClasses }, () =>
      new Array<number>(vocabSize).fill(0)
    );
    const gradB = new Array<number>(numClasses).fill(0);

    for (let i = 0; i < nDocs; i++) {
      const logits = new Array<number>(numClasses);
      for (let c = 0; c < numClasses; c++) {
        let z = biases[c];
        for (let j = 0; j < vocabSize; j++) {
          if (X[i][j] !== 0) z += weights[c][j] * X[i][j];
        }
        logits[c] = z;
      }
      const probs = softmax(logits);
      const target = y[i];

      for (let c = 0; c < numClasses; c++) {
        const err = probs[c] - (c === target ? 1 : 0);
        gradB[c] += err;
        for (let j = 0; j < vocabSize; j++) {
          if (X[i][j] !== 0) {
            gradW[c][j] += err * X[i][j];
          }
        }
      }
    }

    for (let c = 0; c < numClasses; c++) {
      biases[c] -= lr * (gradB[c] / nDocs);
      for (let j = 0; j < vocabSize; j++) {
        weights[c][j] -= lr * (gradW[c][j] / nDocs + reg * weights[c][j]);
      }
    }
  }

  const centroids: number[][] = Array.from({ length: numClasses }, () =>
    new Array<number>(vocabSize).fill(0)
  );
  for (let i = 0; i < nDocs; i++) {
    const c = y[i];
    for (let j = 0; j < vocabSize; j++) {
      centroids[c][j] += X[i][j];
    }
  }
  for (let c = 0; c < numClasses; c++) {
    let normSq = 0;
    for (let j = 0; j < vocabSize; j++) normSq += centroids[c][j] * centroids[c][j];
    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let j = 0; j < vocabSize; j++) centroids[c][j] /= norm;
    }
  }

  const model: TrainedComplaintModel = {
    version: '2.1.0-utility-multilingual',
    algorithm: 'Multilingual TF-IDF + Multinomial Logistic Regression + Weighted Domain Rules',
    trainedAt: new Date().toISOString(),
    categories,
    vocabulary,
    idf,
    weights,
    biases,
    centroids,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(model));
  return model;
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('train_initial_model.ts');
if (isDirectRun) {
  const out = path.resolve(process.cwd(), 'server/ml/models/trained_model.json');
  const model = trainAndSaveModel(out);
  console.log(
    `Trained multilingual utility model saved to ${out} (${model.categories.length} categories, ${Object.keys(model.vocabulary).length} features)`
  );
}
