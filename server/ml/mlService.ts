import { config } from '../config.ts';
import { loadTrainedModel } from './modelLoader.ts';
import {
  discoverCandidateGroups,
  discoverCandidateGroupsAsync,
  isMeaningfulText,
  normalizeText,
  softmax,
  vectorizeWithVocabulary,
} from './modeling.ts';

export type ClassificationStatus = 'Classified' | 'Review' | 'Empty Text';

export interface ComplaintPredictionInput {
  rowIndex: number;
  complaintText: string;
  existingCategory?: string | null;
}

export interface ComplaintPredictionOutput {
  rowIndex: number;
  complaintText: string;
  existingCategory: string | null;
  predictedCategory: string | null;
  confidenceScore: number; // 0..1
  classificationStatus: ClassificationStatus;
  needsReview: boolean;
  candidateGroup: string | null;
}

interface WeightedRulePattern {
  regex: RegExp;
  weight: number;
}

interface DomainRuleSet {
  category: string;
  patterns: WeightedRulePattern[];
  antiPatterns?: RegExp[];
}

const UTILITY_SPECIFIC_RULES: DomainRuleSet[] = [
  {
    category: 'Power supply interruption / meter powered but home disconnected',
    patterns: [
      {
        weight: 3.8,
        regex:
          /\b(power\s*(cut|outage|interruption|failure)|no\s*(light|power|electricity)|bijl?i\s*(nah?i|nhi|nahee|band|bnd|kat|gayi|chali)|supply\s*(band|bnd|off|disconnected|cut|interrupted)|home\s*disconnected|meter\s*(on|powered|chalu).*(disconnect|no\s*light|no\s*power|band|nah?i)|light\s*(nah?i|nhi|band|gayi)|phase\s*(off|down|band|nah?i|nhi)|line\s*fault|cable\s*fault|overhead\s*wire|wire\s*(broken|snapped|cut|fault)|new\s*connection.*pole|pole\s*installation\s*pending)\b/i,
      },
      {
        weight: 2.0,
        regex: /\b(transformer|electric\s*pole|pole\s*pending|feeder\s*fault|khambh?a|taar\s*tut|tar\s*tut|voltage\s*fluctuation|tripping)\b/i,
      },
      {
        weight: 3.8,
        regex:
          /(बिजली\s*(नहीं|बंद|कट|गुल)|सप्लाई\s*(बंद|बाधित)|लाइट\s*(नहीं|बंद|कटी)|ट्रांसफार्मर|फेज\s*(ऑफ|नहीं|बंद)|लाइन\s*फॉल्ट|केबल\s*फॉल्ट|आपूर्ति\s*बाधित|तार\s*टूट|खंभ|पोल)/,
      },
    ],
  },
  {
    category: 'Recharge/payment made but balance not updated',
    patterns: [
      {
        weight: 4.0,
        regex:
          /\b(recharge\s*(kiya|kara|karwaya|done|made|success|successful)|payment\s*(deducted|made|done|pending).*balance|balance\s*(not\s*updated|update\s*nah?i|update\s*nhi|nah?i\s*badha|nhi\s*badha|zero)|amount\s*(not\s*credited|deducted.*credit)|recharge.*(not\s*updated|not\s*credited|pending|update\s*nah?i|update\s*nhi)|upi.*(recharge|payment|pending)|online\s*recharge.*(pending|not\s*updated)|pais[ae]\s*kat.*(recharge|balance|update))\b/i,
      },
      {
        weight: 2.1,
        regex: /\b(recharge\s*pending|token\s*not\s*received|recharge\s*token|prepaid\s*recharge)\b/i,
      },
      {
        weight: 4.0,
        regex:
          /(रिचार्ज\s*(किया|करने|पेंडिंग)|बैलेंस\s*(अपडेट\s*नहीं|नहीं\s*बढ़ा)|अमाउंट\s*क्रेडिट\s*नहीं|यूपीआई.*(पेमेंट|रिचार्ज)|ऑनलाइन\s*भुगतान.*बैलेंस|पैसा\s*कट.*बैलेंस)/,
      },
    ],
  },
  {
    category: 'Unexpected / excess / wrong deduction or billing charges',
    patterns: [
      {
        weight: 3.8,
        regex:
          /\b((extra|wrong|excess|unexpected|high|double)\s*deduction|daily\s*deduction\s*(high|jyada|zyada|excess)|wrong\s*(charge|charges|billing\s*charge|deduction)|extra\s*charge|pais[ae]\s*(kat\s*gaya|kat\s*raha|kat\s*rahe|jyada\s*kat|zyada\s*kat)|arrear\s*deduction|deducted\s*twice|overcharged|balance\s*(kat\s*gaya|deducting\s*fast))\b/i,
      },
      {
        weight: 2.2,
        regex: /\b(penalty|surcharge|fixed\s*charge\s*deduct|bina\s*wajah.*kat|galat\s*deduction)\b/i,
      },
      {
        weight: 3.8,
        regex:
          /(अतिरिक्त\s*कटौती|ज्यादा\s*पैसा\s*कट|अधिक\s*पैसा\s*कट|गलत\s*(कटौती|चार्ज)|पेनल्टी|सरचार्ज|दैनिक\s*कटौती|बैलेंस\s*कट\s*गया)/,
      },
    ],
  },
  {
    category: 'App login / registration / app data / usage display',
    patterns: [
      {
        weight: 3.9,
        regex:
          /\b(app\s*(login|registration|register|not\s*working|crash|error|nah?i\s*chal|kaam\s*nah?i)|unable\s*to\s*login|login\s*issue|otp\s*(not|nah?i|nhi|fail|expired|issue)|consumer\s*(number|id)?\s*link|usage\s*display|usage\s*(not\s*showing|nah?i\s*dikh)|balance\s*not\s*showing\s*(in|on)\s*app|not\s*showing\s*in\s*app|app\s*mei?n\s*(nah?i|nhi|usage|balance)|mobile\s*app)\b/i,
      },
      {
        weight: 2.0,
        regex: /\b(smart\s*meter\s*app|bijli\s*app|suvidha\s*app)\b/i,
      },
      {
        weight: 3.9,
        regex:
          /(ऐप\s*(लॉगिन|काम\s*नहीं|नहीं\s*चल|पंजीकरण|में)|ओटीपी|उपभोक्ता\s*संख्या\s*लिंक|मोबाइल\s*ऐप)/,
      },
    ],
  },
  {
    category: 'Meter damaged / faulty / display / blank / not working',
    patterns: [
      {
        weight: 3.8,
        regex:
          /\b(meter\s*(burnt|burned|damaged|faulty|kharab|kharaab|jal\s*gaya|jala|melted|cracked|broken|not\s*working)|faulty\s*meter|damaged\s*meter|burnt\s*meter|(display|screen)\s*(is\s*)?(blank|off|damaged|broken|not\s*working|nah?i\s*dikh)|blank\s*display|mcb\s*(broken|burnt|kharab|fault)|seal\s*broken|sparking\s*in\s*meter|meter\s*sparking)\b/i,
      },
      {
        weight: 3.8,
        regex:
          /(मीटर\s*(जल\s*गया|जला|खराब|टूटा|काम\s*नहीं)|डिस्प्ले\s*(ब्लैंक|बंद|नहीं)|सील\s*टूटा|एमसीबी|स्क्रीन\s*बंद)/,
      },
    ],
  },
  {
    category: 'Bill generation / high bill / billing correction',
    patterns: [
      {
        weight: 3.8,
        regex:
          /\b((high|excessive|inflated|abnormal|wrong|incorrect|average)\s*bill|bill\s*(not\s*generated|generate\s*nah?i|generate\s*nhi|nah?i\s*bana|nah?i\s*aaya|generation|correction|rectification|rectify|revise|revision|sudhar|mismatch)|jyada\s*bill|zyada\s*bill|bahut\s*bill)\b/i,
      },
      {
        weight: 2.0,
        regex: /\b(electricity\s*bill.*(high|wrong|revise|correct)|corrected\s*bill|monthly\s*bill.*high)\b/i,
      },
      {
        weight: 3.8,
        regex:
          /(बिल\s*(बहुत\s*ज्यादा|जनरेट\s*नहीं|नहीं\s*बना|नहीं\s*आया|सुधार|संशोधन)|उच्च\s*बिल|अधिक\s*बिल|गलत\s*(औसत\s*)?बिल|औसत\s*बिल|बिलिंग\s*सुधार)/,
      },
    ],
  },
  {
    category: 'Meter not communicating',
    patterns: [
      {
        weight: 4.0,
        regex:
          /\b(not\s*communicating|communicat(e|ing)\s*(nah?i|nhi)\s*(kar|ho)\s*raha|communication\s*(failure|issue|error|problem)|offline\s*meter|meter\s*(is\s*)?offline|data\s*(is\s*)?not\s*syncing|sync\s*(nah?i|nhi)\s*ho\s*raha|(signal|network)\s*(issue|problem)\s*(in|at)\s*meter|modem\s*fault|rf\s*(issue|failure))\b/i,
      },
      {
        weight: 2.0,
        regex: /\b(signal\s*(nah?i|nhi)|no\s*network\s*in\s*meter|telemetry\s*offline)\b/i,
      },
      {
        weight: 4.0,
        regex:
          /(कम्युनिकेट\s*नहीं|कम्युनिकेशन\s*(फेल्योर|समस्या)|ऑफलाइन\s*मीटर|मीटर\s*ऑफलाइन|सिग्नल\s*समस्या|डेटा\s*सिंक\s*नहीं)/,
      },
    ],
  },
  {
    category: 'SMS / bill message / notification not received',
    patterns: [
      {
        weight: 4.0,
        regex:
          /\b(sms\s*(alert\s*)?(not\s*received|nah?i\s*aata|nhi\s*aata|nah?i\s*aa\s*raha|stopped|band)|no\s*sms|(bill\s*)?message\s*(not\s*received|nah?i\s*aata|nhi\s*aata)|notification\s*(band|not\s*received|nah?i)|alert\s*(band|not\s*received|stopped)|low\s*balance\s*alert\s*sms)\b/i,
      },
      {
        weight: 4.0,
        regex:
          /(एसएमएस\s*(नहीं|बंद)|मैसेज\s*(नहीं|बंद)|नोटिफिकेशन\s*(मैसेज|नहीं|बंद)|अलर्ट\s*(बंद|नहीं)|बिल\s*सूचना\s*एसएमएस)/,
      },
    ],
  },
  {
    category: 'Meter reading / consumption / deduction not happening',
    patterns: [
      {
        weight: 3.9,
        regex:
          /\b(reading\s*(not\s*updating|update\s*nah?i|update\s*nhi|nah?i\s*badh|stuck|frozen|ruki)|no\s*reading|consumption\s*zero|zero\s*consumption|(unit|units|balance)\s*(are\s*|is\s*)?(not\s*deducting|nah?i\s*kat|nhi\s*kat)|deduction\s*(not\s*happening|nah?i\s*ho\s*raha|nhi\s*ho\s*raha)|kwh\s*(not\s*moving|frozen))\b/i,
      },
      {
        weight: 3.9,
        regex:
          /(रीडिंग\s*(अपडेट\s*नहीं|नहीं\s*बढ़|रुकी)|खपत\s*शून्य|यूनिट\s*(कटौती\s*नहीं|नहीं\s*कट)|बैलेंस\s*नहीं\s*कट|कटौती\s*नहीं\s*हो\s*रही)/,
      },
    ],
  },
  {
    category: 'Load change / load increase or decrease',
    patterns: [
      {
        weight: 4.0,
        regex:
          /\b(load\s*(change|increase|decrease|enhancement|reduction|badhana|badhwana|kam\s*karwana|kam\s*karna)|sanction(ed)?\s*load|kw\s*(change|increase|decrease|enhancement|badhana|kam)|connected\s*load\s*change)\b/i,
      },
      {
        weight: 4.0,
        regex:
          /(लोड\s*(बढ़ाने|बढ़वाना|कम\s*करवाना|कम\s*करने|परिवर्तन)|स्वीकृत\s*लोड|सैंक्शन\s*लोड|किलोवाट)/,
      },
    ],
  },
  {
    category: 'Meter shifting / seal / replacement / wrong meter',
    patterns: [
      {
        weight: 3.9,
        regex:
          /\b(meter\s*(shift|shifting|relocate|replace|replacement|badalna|hatwana|seal|reseal|nah?i\s*laga|nhi\s*laga|not\s*installed)|shift\s*(electric\s*)?meter|relocate\s*(electric\s*)?meter|replace\s*meter|new\s*meter\s*installation|naya\s*meter\s*lagwana|wrong\s*meter(\s*mapped)?|padosi\s*ka\s*meter)\b/i,
      },
      {
        weight: 3.9,
        regex:
          /(मीटर\s*(शिफ्ट|हटाना|बदला|बदलना|रिप्लेसमेंट|सील|नहीं\s*लगा)|नया\s*मीटर|गलत\s*मीटर)/,
      },
    ],
  },
  {
    category: 'Free electricity / subsidy / free units',
    patterns: [
      {
        weight: 4.2,
        regex:
          /\b(subsidy|125\s*units?|free\s*(unit|units|electricity|bijl?i)|mukhyamantri|government\s*(free\s*)?scheme)\b/i,
      },
      {
        weight: 4.2,
        regex: /(सब्सिडी|125\s*यूनिट|फ्री\s*यूनिट|मुफ्त\s*बिजली|मुख्यमंत्री)/,
      },
    ],
    antiPatterns: [
      /\b(disconnect|pole|wire|transformer|power\s*cut|no\s*light|line\s*fault|cable\s*fault|supply\s*band)\b/i,
    ],
  },
  {
    category: 'Previous payment/arrears/incorrect payment adjustment',
    patterns: [
      {
        weight: 3.9,
        regex:
          /\b(old\s*(arrear|arrears|dues)|previous\s*payment|payment\s*adjustment|not\s*adjusted|adjust\s*(nah?i|nhi)|dues\s*mismatch|arrear\s*adjustment|pending\s*arrear|puran[ae]\s*(arrear|bakaya)|pichla\s*payment|ledger\s*mismatch)\b/i,
      },
      {
        weight: 3.9,
        regex:
          /(पिछला\s*भुगतान|समायोजित\s*नहीं|पुराना\s*बकाया|एरियर|बकाया\s*राशि.*गलत|समायोजन)/,
      },
    ],
  },
];

const OTHER_UNCLEAR_PATTERNS: RegExp[] = [
  /\b(ivrs\s*(attached|enclosed)|letter\s*attached|application\s*attached|attachment\s*only)\b/i,
  /\b(closed\s*without\s*(resolution|action|remark|reason)|resolved\s*without\s*action)\b/i,
  /^(please\s*check|plz\s*check|check\s*and\s*call|call\s*back|problem\s*hai|issue\s*hai|sir\s*problem\s*hai|incomplete|unclear|na|nil|ok|test)$/i,
  /(अस्पष्ट\s*विवरण|शिकायत\s*की\s*जांच\s*करें|कृपया\s*संपर्क\s*करें|बिना\s*समाधान\s*बंद)/,
];

export function classifyComplaintBatch(
  items: ComplaintPredictionInput[],
  confidenceThreshold = config.confidenceThreshold,
  modelPath?: string
): ComplaintPredictionOutput[] {
  const model = loadTrainedModel(modelPath);
  const numClasses = model.categories.length;
  const categoryIndexMap = new Map<string, number>();
  model.categories.forEach((cat, idx) => categoryIndexMap.set(cat, idx));

  const subsidyIdx = categoryIndexMap.get('Free electricity / subsidy / free units');
  const otherIdx = categoryIndexMap.get('Other / unclear / incomplete');

  return items.map((item) => {
    const rawText = item.complaintText ?? '';
    if (!isMeaningfulText(rawText)) {
      return {
        rowIndex: item.rowIndex,
        complaintText: rawText,
        existingCategory: item.existingCategory || null,
        predictedCategory: null,
        confidenceScore: 0,
        classificationStatus: 'Empty Text',
        needsReview: false,
        candidateGroup: null,
      };
    }

    const { vector, nonZeroIndices, coverageRatio } = vectorizeWithVocabulary(
      rawText,
      model.vocabulary,
      model.idf
    );

    const normalizedRaw = normalizeText(rawText);

    // Sparse Logistic Regression logits + centroid cosine similarity
    const logits = new Array<number>(numClasses);
    let maxCosSim = 0;

    for (let c = 0; c < numClasses; c++) {
      let z = model.biases[c];
      const wRow = model.weights[c];
      const centRow = model.centroids[c];
      let sim = 0;

      for (let p = 0; p < nonZeroIndices.length; p++) {
        const idx = nonZeroIndices[p];
        const val = vector[idx];
        z += wRow[idx] * val;
        sim += centRow[idx] * val;
      }

      logits[c] = z;
      if (sim > maxCosSim) {
        maxCosSim = sim;
      }
    }

    // Score against the 13 specific technical/billing utility rules
    let specificRuleHits = 0;
    const ruleScores = new Array<number>(numClasses).fill(0);

    for (const rule of UTILITY_SPECIFIC_RULES) {
      const catIdx = categoryIndexMap.get(rule.category);
      if (catIdx === undefined) continue;

      let catBoost = 0;
      for (const pat of rule.patterns) {
        if (pat.regex.test(rawText) || pat.regex.test(normalizedRaw)) {
          catBoost += pat.weight;
        }
      }

      // Guard against false subsidy matches on disconnect/pole complaints
      if (catBoost === 0 && rule.antiPatterns) {
        for (const anti of rule.antiPatterns) {
          if (anti.test(rawText) || anti.test(normalizedRaw)) {
            logits[catIdx] -= 2.8;
            break;
          }
        }
      }

      if (catBoost > 0) {
        logits[catIdx] += catBoost;
        ruleScores[catIdx] = catBoost;
        specificRuleHits++;
      }
    }

    // If a disconnect/pole/supply complaint lacks subsidy keywords, penalize subsidy logit directly
    if (
      subsidyIdx !== undefined &&
      ruleScores[subsidyIdx] === 0 &&
      /\b(disconnect|pole|wire|transformer|power\s*cut|no\s*light|line\s*fault|cable)\b/i.test(
        rawText
      )
    ) {
      logits[subsidyIdx] -= 3.2;
    }

    // Evaluate 'Other / unclear / incomplete' strictly when NO specific utility rule matched
    let otherMatched = false;
    if (specificRuleHits === 0 && otherIdx !== undefined) {
      const isExplicitOther = OTHER_UNCLEAR_PATTERNS.some(
        (re) => re.test(rawText.trim()) || re.test(normalizedRaw)
      );
      const wordCount = normalizedRaw ? normalizedRaw.split(' ').length : 0;
      if (isExplicitOther || wordCount <= 2) {
        logits[otherIdx] += 2.9;
        ruleScores[otherIdx] = 2.9;
        otherMatched = true;
      }
    }

    const probs = softmax(logits);
    let bestIdx = 0;
    let bestProb = probs[0];
    for (let c = 1; c < numClasses; c++) {
      if (probs[c] > bestProb) {
        bestProb = probs[c];
        bestIdx = c;
      }
    }

    const matchedRuleBoost = ruleScores[bestIdx];
    let calibratedConfidence: number;

    if (matchedRuleBoost > 0 || (specificRuleHits > 0 && bestProb >= 0.5)) {
      // High-confidence calibration (>= 0.65) for confirmed multilingual domain utility matches
      const rawCalibrated =
        0.54 + 0.41 * bestProb + Math.min(0.08, matchedRuleBoost * 0.015);
      calibratedConfidence = Number(
        Math.min(0.98, Math.max(0.66, rawCalibrated)).toFixed(4)
      );
    } else if (otherMatched) {
      calibratedConfidence = Number(
        Math.min(0.92, Math.max(0.66, 0.56 + 0.34 * bestProb)).toFixed(4)
      );
    } else {
      // Novel/unmatched complaints rely strictly on TF-IDF centroid similarity & token coverage
      const domainGate = Math.min(
        1,
        Math.max(0.15, (maxCosSim / 0.14) * (0.55 + 0.45 * coverageRatio))
      );
      calibratedConfidence = Number(
        Math.min(0.999, Math.max(0.01, bestProb * domainGate)).toFixed(4)
      );
    }

    const needsReview = calibratedConfidence < confidenceThreshold;
    const status: ClassificationStatus = needsReview ? 'Review' : 'Classified';

    return {
      rowIndex: item.rowIndex,
      complaintText: rawText,
      existingCategory: item.existingCategory || null,
      predictedCategory: model.categories[bestIdx],
      confidenceScore: calibratedConfidence,
      classificationStatus: status,
      needsReview,
      candidateGroup: null,
    };
  });
}

export function assignCandidateGroups(
  predictions: ComplaintPredictionOutput[],
  minClusterSize = config.minClusterSize
): ComplaintPredictionOutput[] {
  const reviewEntries: { originalPos: number; text: string }[] = [];
  predictions.forEach((p, idx) => {
    if (
      p.needsReview &&
      p.classificationStatus === 'Review' &&
      isMeaningfulText(p.complaintText)
    ) {
      reviewEntries.push({ originalPos: idx, text: p.complaintText });
    }
  });

  if (reviewEntries.length < minClusterSize) {
    return predictions;
  }

  const { clusterLabels } = discoverCandidateGroups(
    reviewEntries.map((r) => r.text),
    minClusterSize
  );

  const updated = predictions.map((p) => ({ ...p }));
  reviewEntries.forEach((entry, i) => {
    updated[entry.originalPos].candidateGroup = clusterLabels[i];
  });

  return updated;
}

export async function assignCandidateGroupsAsync(
  predictions: ComplaintPredictionOutput[],
  minClusterSize = config.minClusterSize
): Promise<ComplaintPredictionOutput[]> {
  const reviewEntries: { originalPos: number; text: string }[] = [];
  predictions.forEach((p, idx) => {
    if (
      p.needsReview &&
      p.classificationStatus === 'Review' &&
      isMeaningfulText(p.complaintText)
    ) {
      reviewEntries.push({ originalPos: idx, text: p.complaintText });
    }
  });

  if (reviewEntries.length < minClusterSize) {
    return predictions;
  }

  const { clusterLabels } = await discoverCandidateGroupsAsync(
    reviewEntries.map((r) => r.text),
    minClusterSize
  );

  const updated = predictions.map((p) => ({ ...p }));
  reviewEntries.forEach((entry, i) => {
    updated[entry.originalPos].candidateGroup = clusterLabels[i];
  });

  return updated;
}
