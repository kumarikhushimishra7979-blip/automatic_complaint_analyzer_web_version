import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignCandidateGroups,
  classifyComplaintBatch,
} from '../ml/mlService.ts';

test('ML Service classifies English, Hinglish, and Hindi Devanagari utility complaints with >= 0.65 confidence', () => {
  const inputs = [
    {
      rowIndex: 1,
      complaintText:
        'Bijli nahi aa rahi hai subah se, supply band hai and pole cable fault occurred.',
    },
    {
      rowIndex: 2,
      complaintText:
        'Recharge done online payment deducted ho gaya par balance not updated yet.',
    },
    {
      rowIndex: 3,
      complaintText:
        'मीटर जल गया है और डिस्प्ले बंद है, please inspect faulty meter.',
    },
    {
      rowIndex: 4,
      complaintText:
        'बिजली नहीं आ रही है घर में सप्लाई बंद है, कृपया जांच करें।',
    },
    {
      rowIndex: 5,
      complaintText:
        'Meter communicate nahi kar raha hai and signal issue showing offline.',
    },
    {
      rowIndex: 6,
      complaintText:
        '125 unit free electricity mukhyamantri subsidy benefit not applied in bill.',
    },
    {
      rowIndex: 7,
      complaintText:
        'Naya meter replacement pending hai abhi tak meter nahi laga.',
    },
    {
      rowIndex: 8,
      complaintText:
        'New connection pole installation pending and home supply disconnected near pole.',
    },
    {
      rowIndex: 9,
      complaintText:
        'IVRS attached without issue text, closed without resolution.',
    },
  ];

  const results = classifyComplaintBatch(inputs, 0.4);
  assert.equal(results.length, 9);

  for (const r of results) {
    assert.equal(r.classificationStatus, 'Classified');
    assert.ok(
      r.confidenceScore >= 0.65,
      `Expected >= 0.65 confidence for "${r.complaintText}", got ${r.confidenceScore}`
    );
  }

  assert.equal(
    results[0].predictedCategory,
    'Power supply interruption / meter powered but home disconnected'
  );
  assert.equal(
    results[1].predictedCategory,
    'Recharge/payment made but balance not updated'
  );
  assert.equal(
    results[2].predictedCategory,
    'Meter damaged / faulty / display / blank / not working'
  );
  assert.equal(
    results[3].predictedCategory,
    'Power supply interruption / meter powered but home disconnected'
  );
  assert.equal(results[4].predictedCategory, 'Meter not communicating');
  assert.equal(results[5].predictedCategory, 'Free electricity / subsidy / free units');
  assert.equal(
    results[6].predictedCategory,
    'Meter shifting / seal / replacement / wrong meter'
  );
  // Generic disconnect/pole complaint must NOT fall into Free electricity
  assert.equal(
    results[7].predictedCategory,
    'Power supply interruption / meter powered but home disconnected'
  );
  assert.equal(results[8].predictedCategory, 'Other / unclear / incomplete');
});

test('ML Service handles empty and punctuation-only complaints accurately without dropping valid Hindi text', () => {
  const results = classifyComplaintBatch(
    [
      { rowIndex: 1, complaintText: '' },
      { rowIndex: 2, complaintText: '   \t\n  ' },
      { rowIndex: 3, complaintText: '---' },
      { rowIndex: 4, complaintText: 'बिल बहुत ज्यादा आया है कृपया सुधार करें' },
    ],
    0.4
  );

  assert.equal(results.length, 4);
  for (let i = 0; i < 3; i++) {
    const r = results[i];
    assert.equal(r.classificationStatus, 'Empty Text');
    assert.equal(r.predictedCategory, null);
    assert.equal(r.confidenceScore, 0);
    assert.equal(r.needsReview, false);
  }

  assert.notEqual(results[3].classificationStatus, 'Empty Text');
  assert.equal(
    results[3].predictedCategory,
    'Bill generation / high bill / billing correction'
  );
  assert.equal(results[3].classificationStatus, 'Classified');
});

test('ML Service flags emerging unseen issues as Review and discovers candidate groups via KMeans', () => {
  const inputs = [
    {
      rowIndex: 1,
      complaintText: 'I made a UPI recharge and payment was deducted but balance not updated.',
    },
    {
      rowIndex: 2,
      complaintText: 'Solar rooftop net-metering export credit missing from monthly cycle.',
    },
    {
      rowIndex: 3,
      complaintText: 'Solar rooftop net-metering generation telemetry not recorded.',
    },
    {
      rowIndex: 4,
      complaintText: 'Solar rooftop net-metering bi-directional export ratio mismatch.',
    },
    {
      rowIndex: 5,
      complaintText: 'Biometric kiosk at subdivision counter unresponsive during eKYC.',
    },
  ];

  const classified = classifyComplaintBatch(inputs, 0.4);
  const clustered = assignCandidateGroups(classified, 2);

  assert.equal(clustered.length, inputs.length);
  clustered.forEach((item, idx) => {
    assert.equal(item.rowIndex, inputs[idx].rowIndex);
  });

  // Known recharge complaint stays Classified without candidate group
  assert.equal(clustered[0].classificationStatus, 'Classified');
  assert.equal(clustered[0].candidateGroup, null);

  // Emerging solar rooftop complaints should be Review and share a candidate group
  assert.equal(clustered[1].classificationStatus, 'Review');
  assert.equal(clustered[2].classificationStatus, 'Review');
  assert.equal(clustered[3].classificationStatus, 'Review');
  assert.ok(clustered[1].candidateGroup !== null);
  assert.equal(clustered[1].candidateGroup, clustered[2].candidateGroup);
  assert.equal(clustered[2].candidateGroup, clustered[3].candidateGroup);

  // Unrelated singleton review complaint should not be forced into the solar rooftop group
  assert.equal(clustered[4].classificationStatus, 'Review');
  assert.notEqual(clustered[4].candidateGroup, clustered[1].candidateGroup);
});

test('ML Service processes 3,000 complaints including KMeans clustering within 5 seconds', async () => {
  const { assignCandidateGroupsAsync } = await import('../ml/mlService.ts');
  const samples = [
    'Bijli nahi aa rahi hai subah se and transformer line fault occurred.',
    'Maine 500 ka recharge kiya payment deducted ho gaya par balance update nahi hua.',
    'मीटर जल गया है और डिस्प्ले बंद है, कृपया मीटर बदलें।',
    'Solar rooftop net-metering export credit missing from monthly cycle.',
    'Biometric kiosk at subdivision counter unresponsive during eKYC.',
    'SMS alert not received and bill message nahi aata.',
  ];
  const inputs = Array.from({ length: 3000 }, (_, i) => ({
    rowIndex: i + 1,
    complaintText: `${samples[i % samples.length]} case reference ${i % 97}`,
  }));

  const t0 = Date.now();
  const classified = classifyComplaintBatch(inputs, 0.4);
  const clustered = await assignCandidateGroupsAsync(classified, 2);
  const elapsedMs = Date.now() - t0;

  assert.equal(clustered.length, 3000);
  assert.ok(elapsedMs < 5000, `Expected < 5000ms for 3000 rows, got ${elapsedMs}ms`);
});
