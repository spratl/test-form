// ---------- Config ----------
const HR_EMAIL = "hr@sprautotech.com"; // TODO: replace with actual HR intake email
const STEPS = ["Applicant & Photo","Personal Particulars","Other Particulars","Qualifications","Experience","References","Remuneration","Declaration"];
const STORAGE_KEY = "spr_form_draft_v1";

let currentStep = 0;
let photoDataUrl = null;
let logoDataUrl = null;
let logo2DataUrl = null;
let clientIP = null;
let pdfFontFamily = 'helvetica';
let saveTimer;

fetch('logo.png').then(r => r.blob()).then(blob => {
  const reader = new FileReader();
  reader.onload = () => { logoDataUrl = reader.result; };
  reader.readAsDataURL(blob);
}).catch(() => { logoDataUrl = null; });

fetch('logo2.png').then(r => r.blob()).then(blob => {
  const reader = new FileReader();
  reader.onload = () => { logo2DataUrl = reader.result; };
  reader.readAsDataURL(blob);
}).catch(() => { logo2DataUrl = null; });

// Public IP lookup — a browser has no built-in way to know its own public IP,
// so we ask a free external service. Best-effort only: if it fails or is blocked
// (ad-blockers, offline use), the form still works — the PDF just shows "Not available".
async function fetchClientIP(){
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const json = await res.json();
    return json.ip || null;
  } catch(e){ return null; }
}
fetchClientIP().then(ip => { clientIP = ip; });

// ---------- Progress nav ----------
const track = document.getElementById('progressTrack');
STEPS.forEach((label, i) => {
  const el = document.createElement('div');
  el.className = 'progress-step' + (i === 0 ? ' active' : '');
  el.textContent = (i+1) + '. ' + label;
  el.dataset.step = i;
  el.addEventListener('click', () => goToStep(i));
  track.appendChild(el);
});

function goToStep(i){
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', +s.dataset.step === i));
  document.querySelectorAll('.progress-step').forEach(s => {
    const si = +s.dataset.step;
    s.classList.toggle('active', si === i);
    s.classList.toggle('done', si < i);
  });
  currentStep = i;
  document.getElementById('prevBtn').style.visibility = i === 0 ? 'hidden' : 'visible';
  document.getElementById('nextBtn').textContent = i === STEPS.length - 1 ? 'Review ✓' : 'Next →';
  window.scrollTo({top:0, behavior:'smooth'});
  saveDraft();
}

document.getElementById('nextBtn').addEventListener('click', () => {
  const activeSection = document.querySelector('.section.active');
  const missingInStep = findMissingRequiredFields().filter(el => el.closest('.section') === activeSection);
  if (missingInStep.length){
    highlightMissingFields(missingInStep);
    missingInStep[0].reportValidity();
    return;
  }
  const invalid = activeSection.querySelector(':invalid');
  if (invalid) { invalid.reportValidity(); return; }
  if (currentStep < STEPS.length - 1) goToStep(currentStep + 1);
});
document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentStep > 0) goToStep(currentStep - 1);
});
goToStep(0);

// ---------- Dynamic repeating rows ----------
document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tableId = btn.dataset.add;
    const cols = btn.dataset.cols.split(',');
    const selectCols = (btn.dataset.selectCols || '').split(',').filter(Boolean);
    const requiredRows = parseInt(btn.dataset.requiredRows || '0', 10);
    let colOptions = {};
    if (btn.dataset.colOptions) {
      try { colOptions = JSON.parse(btn.dataset.colOptions); } catch(e){ colOptions = {}; }
    }
    const tbody = document.getElementById(tableId).querySelector('tbody');
    const rowIndex = tbody.children.length;
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const td = document.createElement('td');
      let input;
      if (selectCols.includes(col)) {
        input = document.createElement('select');
        const opts = colOptions[col];
        if (opts && opts.length) {
          input.innerHTML = '<option value="">Select</option>' + opts.map(o => `<option value="${o}">${o}</option>`).join('');
        } else {
          input.innerHTML = '<option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option>';
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      if (requiredRows > 0 && rowIndex < requiredRows) input.required = true;
      input.name = tableId + '__' + col;
      input.dataset.col = col;
      td.appendChild(input);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
});
// seed each repeating table with its configured default number of rows
document.querySelectorAll('[data-add]').forEach(btn => {
  const n = parseInt(btn.dataset.default || '1', 10);
  for (let i = 0; i < n; i++) btn.click();
});

// ---------- Remuneration group inline "+ Add row" (extends the same visual list, no separate table) ----------
let remRowCounter = 0;
document.querySelectorAll('[data-remgroup]').forEach(btn => {
  btn.addEventListener('click', () => {
    const containerId = btn.dataset.remgroup;
    const amountPlaceholder = btn.dataset.amountPlaceholder || 'Amount';
    const container = document.getElementById(containerId);
    const row = document.createElement('div');
    row.className = 'rem-row-added';
    const idSuffix = '_added' + (++remRowCounter);
    const labelInput = document.createElement('input');
    labelInput.type = 'text'; labelInput.placeholder = 'Particulars';
    labelInput.name = containerId + idSuffix + 'Particulars';
    labelInput.dataset.role = 'particulars';
    const amountInput = document.createElement('input');
    amountInput.type = 'text'; amountInput.placeholder = amountPlaceholder;
    amountInput.name = containerId + idSuffix + 'Amount';
    amountInput.dataset.role = 'amount';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'remove-row'; rm.innerHTML = '✕';
    rm.addEventListener('click', () => row.remove());
    row.appendChild(labelInput); row.appendChild(amountInput); row.appendChild(rm);
    container.appendChild(row);
  });
});

// ---------- Auto sentence-case free-text input (first letter capital, rest lower-case) ----------
document.getElementById('dataForm').addEventListener('input', (e) => {
  const el = e.target;
  const isFreeText = (el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && el.type === 'text');
  if (!isFreeText) return;
  const val = el.value;
  if (!val) return;
  const sentenceCased = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
  if (sentenceCased !== val) {
    const start = el.selectionStart, end = el.selectionEnd;
    el.value = sentenceCased;
    if (start !== null && el.setSelectionRange) el.setSelectionRange(start, end);
  }
});

// ---------- Mandatory-field check: highlight any unfilled required box, wherever it is ----------
// (native form.checkValidity() ignores required fields on hidden/inactive steps, so a candidate
// who jumps ahead via the progress bar could otherwise skip a mandatory box unnoticed.)
function findMissingRequiredFields(){
  const form = document.getElementById('dataForm');
  return Array.from(form.querySelectorAll('input[required], select[required], textarea[required]'))
    .filter(el => el.type !== 'checkbox')
    .filter(el => !el.value || !String(el.value).trim());
}
function clearMissingHighlight(el){
  if (!el || !el.classList || !el.classList.contains('field-missing')) return;
  const hasValue = el.type === 'checkbox' ? el.checked : (el.value && String(el.value).trim());
  if (hasValue) el.classList.remove('field-missing');
}
function highlightMissingFields(fields){
  document.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));
  fields.forEach(el => el.classList.add('field-missing'));
}
function stepOfElement(el){
  const section = el.closest('.section');
  return section ? parseInt(section.dataset.step, 10) : 0;
}
document.getElementById('dataForm').addEventListener('input', (e) => clearMissingHighlight(e.target));
document.getElementById('dataForm').addEventListener('change', (e) => clearMissingHighlight(e.target));

// ---------- Auto-calculate Age from Date of Birth ----------
function updateAgeFromDob(){
  const dobVal = document.getElementById('dobInput').value;
  const ageInput = document.getElementById('ageInput');
  if (!dobVal) { ageInput.value = ''; return; }
  const dob = new Date(dobVal);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear = (today.getMonth() > dob.getMonth()) ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  ageInput.value = age >= 0 ? age : '';
}
document.getElementById('dobInput').addEventListener('change', updateAgeFromDob);

// ---------- Photo capture / resize ----------
// Draws any image source (an <img> or an ImageBitmap) into a fixed 300x350 canvas
// using a "cover" crop, so the result always exactly matches the PDF photo box's
// aspect ratio (38 x 44.3mm) regardless of the original photo's dimensions.
function resizePhotoToCanvas(source, srcW, srcH){
  const targetW = 300, targetH = 350;
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(targetW / srcW, targetH / srcH);
  const sw = targetW / scale, sh = targetH / scale;
  const sx = (srcW - sw) / 2, sy = (srcH - sh) / 2;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetW, targetH);
  photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  photoPreview.innerHTML = '';
  const previewImg = document.createElement('img');
  previewImg.src = photoDataUrl;
  photoPreview.appendChild(previewImg);
  saveDraft();
}

const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Prefer createImageBitmap with imageOrientation:'from-image' — this correctly
  // applies the photo's EXIF rotation before we measure/crop it. Without this, a
  // portrait phone photo whose EXIF tag says "rotate 90°" can get cropped and
  // scaled using its raw (sideways) pixel dimensions, so it ends up looking
  // squeezed or mis-fit inside the box even though the crop math itself is correct.
  if (window.createImageBitmap){
    createImageBitmap(file, { imageOrientation: 'from-image' }).then((bitmap) => {
      resizePhotoToCanvas(bitmap, bitmap.width, bitmap.height);
    }).catch(() => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => resizePhotoToCanvas(img, img.naturalWidth, img.naturalHeight);
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  } else {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => resizePhotoToCanvas(img, img.naturalWidth, img.naturalHeight);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// ---------- Data collection ----------
function collectFormData(){
  const form = document.getElementById('dataForm');
  const data = {};
  // simple named fields
  form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    if (el.name.includes('__')) return; // handled separately as table rows
    data[el.name] = el.value;
  });
  // repeating tables
  const tableIds = new Set();
  document.querySelectorAll('[data-add]').forEach(b => tableIds.add(b.dataset.add));
  tableIds.forEach(tableId => {
    const rows = [];
    document.querySelectorAll('#' + tableId + ' tbody tr').forEach(tr => {
      const row = {};
      let hasValue = false;
      tr.querySelectorAll('input, select').forEach(inp => {
        row[inp.dataset.col] = inp.value;
        if (inp.value.trim()) hasValue = true;
      });
      if (hasValue) rows.push(row);
    });
    data[tableId] = rows;
  });
  data.photoDataUrl = photoDataUrl;
  data.consentChecked = document.getElementById('consentCheck').checked;
  return data;
}

// ---------- Draft autosave ----------
function saveDraft(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = collectFormData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e){ /* storage full or unavailable — ignore silently */ }
  }, 400);
}
document.getElementById('dataForm').addEventListener('input', saveDraft);

function restoreDraft(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const form = document.getElementById('dataForm');
    Object.keys(data).forEach(key => {
      if (['photoDataUrl','consentChecked'].includes(key)) return;
      if (Array.isArray(data[key])) return; // tables restored below
      const el = form.querySelector(`[name="${CSS.escape(key)}"]`);
      if (el) el.value = data[key];
    });
    updateAgeFromDob(); // recompute Age fresh in case time has passed since the draft was saved
    // restore tables
    document.querySelectorAll('[data-add]').forEach(btn => {
      const tableId = btn.dataset.add;
      const rows = data[tableId];
      if (!rows || !rows.length) return;
      const tbody = document.getElementById(tableId).querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(rowData => {
        btn.click();
        const lastRow = tbody.lastElementChild;
        Object.keys(rowData).forEach(col => {
          const inp = lastRow.querySelector(`[data-col="${CSS.escape(col)}"]`);
          if (inp) inp.value = rowData[col];
        });
      });
    });
    // restore dynamically-added remuneration rows (beyond the fixed default boxes)
    ['remMonthlyMoreRows','remAnnualMoreRows','remPerksMoreRows','remCarMoreRows'].forEach(containerId => {
      const indices = new Set();
      Object.keys(data).forEach(key => {
        const m = key.match(new RegExp('^' + containerId + '_added(\\d+)(Particulars|Amount)$'));
        if (m) indices.add(parseInt(m[1], 10));
      });
      if (!indices.size) return;
      const btn = document.querySelector(`[data-remgroup="${containerId}"]`);
      const container = document.getElementById(containerId);
      Array.from(indices).sort((a,b) => a - b).forEach(idx => {
        btn.click();
        const lastRow = container.lastElementChild;
        const pKey = containerId + '_added' + idx + 'Particulars';
        const aKey = containerId + '_added' + idx + 'Amount';
        if (data[pKey] !== undefined) lastRow.querySelector('[data-role="particulars"]').value = data[pKey];
        if (data[aKey] !== undefined) lastRow.querySelector('[data-role="amount"]').value = data[aKey];
      });
    });
    if (data.photoDataUrl) {
      photoDataUrl = data.photoDataUrl;
      photoPreview.innerHTML = '';
      const img = document.createElement('img');
      img.src = photoDataUrl;
      photoPreview.appendChild(img);
    }
    if (data.consentChecked) document.getElementById('consentCheck').checked = true;
  } catch(e){ console.warn('Draft restore failed', e); }
  updateConsentFullName();
}

// ---------- Live-fill the candidate's name into the consent paragraph ----------
function updateConsentFullName(){
  const span = document.getElementById('consentFullName');
  if (!span) return;
  const form = document.getElementById('dataForm');
  const first = (form.querySelector('[name="firstName"]') || {}).value || '';
  const middle = (form.querySelector('[name="middleName"]') || {}).value || '';
  const surname = (form.querySelector('[name="surname"]') || {}).value || '';
  const full = [first, middle, surname].map(s => s.trim()).filter(Boolean).join(' ');
  span.textContent = full || '________________________';
}
document.getElementById('dataForm').addEventListener('input', updateConsentFullName);
restoreDraft();

// ---------- PDF Generation ----------
const PDF_PAGE_W = 210, PDF_MARGIN = 15, PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2;

// Converts an ISO date (YYYY-MM-DD, from <input type="date">) to dd-mm-yyyy for display
function pdfFormatDate(isoDate){
  if (!isoDate) return '';
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const [yyyy, mm, dd] = parts;
  return `${dd}-${mm}-${yyyy}`;
}

function pdfSectionTitle(doc, title, y){
  const boxHeight = 10;
  y = pdfPageBreakIfNeeded(doc, y, boxHeight + 6);
  doc.setFillColor(251,248,238);
  doc.setDrawColor(180,176,166); doc.setLineWidth(0.4);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, boxHeight, 'FD');
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(12); doc.setTextColor(26,39,68);
  doc.text(title, PDF_MARGIN + 4, y + boxHeight / 2 + 3.2);
  return y + boxHeight + 6;
}

function pdfPageBreakIfNeeded(doc, y, needed){
  if (y + needed > 280){ doc.addPage(); return 20; }
  return y;
}

// Fills the current page with the cream background used throughout the document
function pdfFillPageBackground(doc){
  doc.setFillColor(251,248,238);
  doc.rect(0, 0, PDF_PAGE_W, 297, 'F');
}

// Bordered label/value grid for simple fields — crisp, aligned, like a visa application form
function pdfFieldGrid(doc, y, rows, labelWidth){
  labelWidth = labelWidth || 58;
  const body = rows.filter(r => r[1] && String(r[1]).trim()).map(r => [r[0], String(r[1])]);
  if (!body.length) return y;
  y = pdfPageBreakIfNeeded(doc, y, 14);
  doc.autoTable({
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    body: body,
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 9.5, cellPadding: 3, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: labelWidth, fontStyle: 'bold', textColor: [80,80,80], fillColor: [251,248,238] },
      1: { cellWidth: PDF_CONTENT_W - labelWidth }
    },
    tableWidth: PDF_CONTENT_W
  });
  return doc.lastAutoTable.finalY + 7;
}

// Bordered multi-column data table with auto-wrapping — fixes overlapping text
function pdfDataTable(doc, y, title, rows, columns, minBlankRows, rowHeight, columnStyles){
  rows = rows ? rows.slice() : [];
  if (minBlankRows > 0 && rows.length < minBlankRows){
    rows = rows.concat(Array.from({ length: minBlankRows - rows.length }, () => ({})));
  }
  // Reserve room for the title box + table header + at least one body row, so we never
  // strand the title/header alone at the bottom of a page with the data pushed to the next.
  y = pdfPageBreakIfNeeded(doc, y, 40);
  y = pdfSectionTitle(doc, title, y);
  if (!rows.length){
    doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9); doc.setTextColor(140,140,140);
    doc.text('None provided.', PDF_MARGIN, y);
    return y + 8;
  }
  doc.autoTable({
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [columns.map(c => c.label)],
    body: rows.map(r => columns.map(c => r[c.key] && String(r[c.key]).trim() ? r[c.key] : '')),
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 8.5, cellPadding: 2.6, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak', valign: 'top', minCellHeight: rowHeight || 7 },
    headStyles: { fillColor: [251,248,238], textColor: [26,39,68], fontStyle: 'bold', fontSize: 8, lineColor: [205,200,188], lineWidth: 0.3, minCellHeight: 8 },
    columnStyles: columnStyles || {},
    tableWidth: PDF_CONTENT_W
  });
  return doc.lastAutoTable.finalY + 7;
}

// Same bordered data table, but with an explicit per-row minimum height (used when several
// tables together should stretch evenly down to the page's bottom margin instead of leaving
// unused white space below them).
function pdfDataTableFixedRowHeight(doc, y, title, rows, columns, rowHeight, columnStyles){
  y = pdfPageBreakIfNeeded(doc, y, 40);
  y = pdfSectionTitle(doc, title, y);
  doc.autoTable({
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [columns.map(c => c.label)],
    body: rows.map(r => columns.map(c => r[c.key] && String(r[c.key]).trim() ? r[c.key] : '')),
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 8.5, cellPadding: 2.6, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak', valign: 'top', minCellHeight: rowHeight },
    headStyles: { fillColor: [251,248,238], textColor: [26,39,68], fontStyle: 'bold', fontSize: 8, lineColor: [205,200,188], lineWidth: 0.3, minCellHeight: 8 },
    columnStyles: columnStyles || {},
    tableWidth: PDF_CONTENT_W
  });
  return doc.lastAutoTable.finalY + 7;
}

// Distributes remaining vertical space on the page evenly across the body rows of a list of
// tables, so the tables together stretch down to the usual bottom margin instead of leaving
// white space below them. tableSpecs: [{ title, rows, columns, columnStyles }, ...] — rows already final length.
function pdfFillRemainingHeight(doc, y, tableSpecs){
  const bottomMargin = 280;
  const safetyBuffer = 6; // guards against font-metric rounding so rows never spill onto a new page
  const titleBoxH = 10, titleGap = 6, headH = 8.5, interTableGap = 7;
  const totalRows = tableSpecs.reduce((sum, t) => sum + t.rows.length, 0);
  const overhead = tableSpecs.length * (titleBoxH + titleGap + headH) + (tableSpecs.length - 1) * interTableGap + safetyBuffer;
  const available = bottomMargin - y - overhead;
  const rowHeight = Math.max(7, available / Math.max(totalRows, 1));
  tableSpecs.forEach(t => { y = pdfDataTableFixedRowHeight(doc, y, t.title, t.rows, t.columns, rowHeight, t.columnStyles); });
  return y;
}

// Template variant: always shows every label with a blank writable cell (never filters empty values)
// tallLabels: labels that should get a taller row (e.g. addresses, which need more writing room).
function pdfTemplateFieldGrid(doc, y, labels, labelWidth, tallLabels){
  labelWidth = labelWidth || 58;
  tallLabels = tallLabels || [];
  const body = labels.map(l => [l, '']);
  y = pdfPageBreakIfNeeded(doc, y, 14);
  doc.autoTable({
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    body: body,
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 9.5, cellPadding: 3, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak', minCellHeight: 8 },
    columnStyles: {
      0: { cellWidth: labelWidth, fontStyle: 'bold', textColor: [80,80,80], fillColor: [251,248,238] },
      1: { cellWidth: PDF_CONTENT_W - labelWidth }
    },
    didParseCell: function(d){
      if (d.section === 'body' && tallLabels.includes(labels[d.row.index])) d.cell.styles.minCellHeight = 24;
    },
    tableWidth: PDF_CONTENT_W
  });
  return doc.lastAutoTable.finalY + 7;
}

// Template variant: always shows every remuneration line item with a blank writable cell
function pdfTemplateRemGroup(doc, x, y, width, title, labels){
  const body = labels.map(l => [l, '']);
  const boxHeight = 8.5;
  doc.setFillColor(251,248,238);
  doc.setDrawColor(180,176,166); doc.setLineWidth(0.35);
  doc.rect(x, y, width, boxHeight, 'FD');
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9.5); doc.setTextColor(26,39,68);
  doc.text(title, x + 3, y + boxHeight / 2 + 2.8);
  let ny = y + boxHeight + 5;
  doc.autoTable({
    startY: ny,
    margin: { left: x, right: PDF_PAGE_W - x - width },
    body: body,
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 8.5, cellPadding: 2.2, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak', minCellHeight: 8 },
    columnStyles: {
      0: { cellWidth: width * 0.6, fontStyle: 'bold', textColor: [80,80,80] },
      1: { cellWidth: width * 0.4 }
    },
    tableWidth: width
  });
  return doc.lastAutoTable.finalY + 8;
}


function pdfRemGroup(doc, x, y, width, title, rows){
  // Always print every row of the group — including ones the candidate left blank — so the
  // printed Remuneration page always shows the full standard set of fields, not just whichever
  // ones happened to be filled in.
  const body = rows.map(r => [r[0] || '', r[1] ? String(r[1]) : '']);
  const boxHeight = 8.5;
  doc.setFillColor(251,248,238);
  doc.setDrawColor(180,176,166); doc.setLineWidth(0.35);
  doc.rect(x, y, width, boxHeight, 'FD');
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9.5); doc.setTextColor(26,39,68);
  doc.text(title, x + 3, y + boxHeight / 2 + 2.8);
  let ny = y + boxHeight + 5;
  if (!body.length){
    doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(8.5); doc.setTextColor(150,150,150);
    doc.text('None provided.', x, ny);
    return ny + 8;
  }
  doc.autoTable({
    startY: ny,
    margin: { left: x, right: PDF_PAGE_W - x - width },
    body: body,
    theme: 'grid',
    styles: { font: pdfFontFamily, fontSize: 8.5, cellPadding: 2.2, textColor: [30,30,30], lineColor: [205,200,188], lineWidth: 0.2, overflow: 'linebreak', minCellHeight: 7 },
    columnStyles: {
      0: { cellWidth: width * 0.6, fontStyle: 'bold', textColor: [80,80,80] },
      1: { cellWidth: width * 0.4, halign: 'right' }
    },
    tableWidth: width
  });
  return doc.lastAutoTable.finalY + 8;
}

function generatePdf(data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Embed the real Montserrat font so the PDF matches the web form's typography.
  // Falls back to jsPDF's built-in font if the embed fails for any reason.
  pdfFontFamily = 'helvetica';
  if (typeof MONTSERRAT_REGULAR_B64 !== 'undefined'){
    try {
      doc.addFileToVFS('Montserrat-Regular.ttf', MONTSERRAT_REGULAR_B64);
      doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
      doc.addFileToVFS('Montserrat-Bold.ttf', MONTSERRAT_BOLD_B64);
      doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
      pdfFontFamily = 'Montserrat';
    } catch(e){ pdfFontFamily = 'helvetica'; }
  }
  doc.setFont(pdfFontFamily, 'normal');

  // Cream background on every page, including ones autoTable adds automatically
  // when a table splits across a page boundary.
  pdfFillPageBackground(doc);
  doc.internal.events.subscribe('addPage', () => { pdfFillPageBackground(doc); });

  {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,'0');
    const mm = String(now.getMonth() + 1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    data.submissionTimestamp = `${dd}-${mm}-${yyyy}, ${timeStr}`;
  }

  // ---------- Cover page (correctly-proportioned logos) ----------
  const logoH = 15;
  if (logoDataUrl){
    const logoW = logoH * (251 / 106);
    try { doc.addImage(logoDataUrl, 'PNG', PDF_MARGIN, 14, logoW, logoH); } catch(e){}
  }
  if (logo2DataUrl){
    const logo2W = logoH * (151 / 90);
    try { doc.addImage(logo2DataUrl, 'PNG', PDF_PAGE_W - PDF_MARGIN - logo2W, 14, logo2W, logoH); } catch(e){}
  }

  doc.setTextColor(26,39,68); doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(20);
  doc.text('SPR Auto Technologies Ltd.', PDF_PAGE_W / 2, 42, { align: 'center' });
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(11); doc.setTextColor(40,40,40);
  doc.text('PERSONAL DATA FORM — CANDIDATE APPLICATION', PDF_PAGE_W / 2, 49, { align: 'center' });

  doc.setDrawColor(40,40,40); doc.setLineWidth(0.8);
  doc.line(PDF_MARGIN, 55, PDF_PAGE_W - PDF_MARGIN, 55);

  const photoW = 38, photoH = 44.3;
  const photoX = PDF_PAGE_W - PDF_MARGIN - photoW, photoY = 66;
  doc.setDrawColor(190,186,175); doc.setLineWidth(0.3);
  doc.rect(photoX, photoY, photoW, photoH);
  if (data.photoDataUrl){
    try { doc.addImage(data.photoDataUrl, 'JPEG', photoX, photoY, photoW, photoH); } catch(e){}
  }

  doc.setTextColor(20,20,20); doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(21);
  const nameLines = doc.splitTextToSize(data.coverName || '-', 135);
  doc.text(nameLines, PDF_MARGIN, 80);
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(12.5); doc.setTextColor(100,100,100);
  const postLines = doc.splitTextToSize('Applying for: ' + (data.postApplied || 'Not specified'), 135);
  doc.text(postLines, PDF_MARGIN, 80 + nameLines.length * 8.5 + 4);

  if (data.referredBy && data.referredBy.trim()){
    doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10); doc.setTextColor(90,90,90);
    doc.text('Ref: ' + data.referredBy, PDF_PAGE_W - PDF_MARGIN, 285, { align: 'right' });
  }

  // ---------- Personal Particulars ----------
  doc.addPage(); let y = 20;
  y = pdfSectionTitle(doc, 'Personal Particulars', y);
  y = pdfFieldGrid(doc, y, [
    ['Full Name', [data.firstName, data.middleName, data.surname].filter(Boolean).join(' ')],
    ['Present Address', data.presentAddress],
    ['Mobile / Alternate Mobile', [data.phoneResidence, data.phoneMobile].filter(Boolean).join(' / ')],
    ['Permanent Address', data.permanentAddress],
    ['Email', data.email],
    ['Emergency Contact - Relation & Name', data.emergencyContactName],
    ['Emergency Contact - Mobile Number', data.emergencyContactMobile],
    ["Mother's Name", data.motherName], ["Father's Name", data.fatherName], ["Spouse's Name", data.spouseName],
    ['Date of Birth', pdfFormatDate(data.dob)], ['Age', data.age],
    ['Place of Birth / Origin', [data.placeOfBirth, data.placeOfOrigin].filter(Boolean).join(' / ')]
  ], 76);

  const residenceRows = (data.residenceTable || []).slice();
  while (residenceRows.length < 5) residenceRows.push({});
  const familyRows = (data.familyTable || []).slice();
  while (familyRows.length < 5) familyRows.push({});
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Residence History (Last 5 Years)', rows: residenceRows, columns: [
      {key:'from', label:'From'}, {key:'to', label:'To'}, {key:'address', label:'Address'},
      {key:'reason', label:'Reason'}, {key:'referee', label:'Referee'}
    ] },
    { title: 'Family Details / Dependents', rows: familyRows, columns: [
      {key:'relationship', label:'Relationship'}, {key:'age', label:'Age'}, {key:'occupation', label:'Occupation / Reason for Dependency'}
    ] }
  ]);

  // ---------- Other Particulars ----------
  y = pdfFieldGrid(doc, y, [
    ['Other Income Source / Amount', data.otherIncome],
    ['Court Proceedings', data.courtProceedings],
    ['Height / Weight', [data.height ? data.height + ' cms' : '', data.weight ? data.weight + ' kgs' : ''].filter(Boolean).join(' / ')],
    ['Illness / Disability', [data.illness, data.disability].filter(Boolean).join(' / ')]
  ]);
  const orgRows = (data.orgTable || []).slice();
  while (orgRows.length < 5) orgRows.push({});
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Organisation Memberships', rows: orgRows, columns: [
      {key:'org', label:'Organisation'}, {key:'nature', label:'Nature of Association'}
    ] }
  ]);

  // ---------- Qualifications (always starts on its own fresh page) ----------
  doc.addPage(); y = 20;
  y = pdfDataTable(doc, y, 'Educational History', data.eduTable, [
    {key:'institution', label:'Institution'}, {key:'university', label:'University'}, {key:'entering', label:'Entering'},
    {key:'leaving', label:'Leaving'}, {key:'degree', label:'Degree/Exam'}, {key:'subjects', label:'Subjects'}, {key:'marks', label:'Marks %'}
  ], 6, 10.5, {
    0: { cellWidth: 33 }, 1: { cellWidth: 31 }, 2: { cellWidth: 18 }, 3: { cellWidth: 18 },
    4: { cellWidth: 30 }, 5: { cellWidth: 36 }, 6: { cellWidth: 14 }
  });
  y = pdfFieldGrid(doc, y, [
    ['Professional Societies', data.profSocieties],
    ['Honours / Scholarships', data.honours],
    ['Publications / Paper / Thesis', data.publications]
  ]);
  y = pdfDataTable(doc, y, 'Training Attended', data.trainingTable, [
    {key:'name', label:'Training'}, {key:'duration', label:'Duration'}, {key:'faculty', label:'Faculty'}, {key:'content', label:'Content'}
  ], 2);
  y = pdfDataTable(doc, y, 'Languages Known', data.langTable, [
    {key:'language', label:'Language'}, {key:'speak', label:'Speak'}, {key:'read', label:'Read'}, {key:'write', label:'Write'}
  ], 3);

  // ---------- Experience (always starts on its own fresh page) ----------
  doc.addPage(); y = 20;
  y = pdfFieldGrid(doc, y, [
    ['Extra-Curricular (Arts / Social / Sports / Hobbies)', [data.ecArts, data.ecSocial, data.ecSports, data.ecHobbies].filter(Boolean).join(' | ')]
  ]);
  function padAndNumber(arr, minCount, numberFn){
    const padded = (arr || []).slice();
    while (padded.length < minCount) padded.push({});
    return padded.map((r, i) => ({ ...r, sno: numberFn(i) }));
  }
  const empTableNumbered = padAndNumber(data.empTable, 6, i => (i === 0 ? '1 (Present)' : String(i + 1)));
  const respTableNumbered = padAndNumber(data.respTable, 6, i => String(i + 1));
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Past Employment', rows: empTableNumbered, columns: [
      {key:'sno', label:'S.No.'}, {key:'employer', label:'Employer'}, {key:'from', label:'From'}, {key:'to', label:'To'},
      {key:'basic', label:'Basic'}, {key:'total', label:'Total'}, {key:'reason', label:'Reason for Leaving'}
    ], columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 56 }, 2: { cellWidth: 19 }, 3: { cellWidth: 19 },
      4: { cellWidth: 19 }, 5: { cellWidth: 19 }, 6: { cellWidth: 34 }
    } },
    { title: 'Designation / Responsibilities', rows: respTableNumbered, columns: [
      {key:'sno', label:'S.No.'}, {key:'responsibilities', label:'Responsibilities'}, {key:'supervisor', label:'Supervisor'}
    ], columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 121 }, 2: { cellWidth: 45 }
    } }
  ]);

  // ---------- References (always starts on its own fresh page) ----------
  doc.addPage(); y = 20;
  y = pdfDataTable(doc, y, 'Employees of Our Units Known to You', data.empRefTable, [
    {key:'name', label:'Name'}, {key:'rank', label:'Rank'}, {key:'unit', label:'Unit'}, {key:'dept', label:'Deptt.'}, {key:'relation', label:'Relationship'}
  ], 2);
  y = pdfDataTable(doc, y, 'Referees (Not Related)', data.refTable, [
    {key:'name', label:'Name'}, {key:'occupation', label:'Occupation'}, {key:'contact', label:'Address/Phone'}
  ], 2);
  y = pdfDataTable(doc, y, 'Responsible Persons of Your Locality', data.localTable, [
    {key:'name', label:'Name'}, {key:'occupation', label:'Occupation'}, {key:'contact', label:'Address/Phone'}
  ], 2);
  y = pdfFieldGrid(doc, y, [
    ['Notice Period Required', data.noticePeriod],
    ['Appeared for Test/Interview Earlier', [data.earlierInterview, data.earlierCompany, data.earlierPosition, data.earlierWhen].filter(Boolean).join(' — ')],
    ['How Applied', data.howApplied]
  ]);

  // ---------- Remuneration — always starts on its own fresh page, compact two-column layout ----------
  function collectExtraBoxes(prefix, count){
    const rows = [];
    for (let i = 1; i <= count; i++) rows.push([data[prefix + i + 'Particulars'], data[prefix + i + 'Amount']]);
    return rows;
  }
  function collectAddedRows(containerId){
    const rows = [];
    Object.keys(data).forEach(key => {
      const m = key.match(new RegExp('^' + containerId + '_added(\\d+)Particulars$'));
      if (m) rows.push([data[key], data[containerId + '_added' + m[1] + 'Amount']]);
    });
    return rows;
  }

  doc.addPage(); y = 20;
  y = pdfSectionTitle(doc, 'Present Remuneration / Facilities', y);

  const colGap = 8, colW = (PDF_CONTENT_W - colGap) / 2;
  const leftX = PDF_MARGIN, rightX = PDF_MARGIN + colW + colGap;
  let leftY = y, rightY = y;

  leftY = pdfRemGroup(doc, leftX, leftY, colW, 'Monthly Salary Slip', [
    ['Basic', data.remBasic], ['HRA', data.remHRA], ['Conveyance', data.remConveyance],
    ['Medical Allowance', data.remMedicalAllowance], ['Other Allowances', data.remOtherAllowances], ['PF', data.remPF],
    ...collectExtraBoxes('remMonthlyExtra', 6), ...collectAddedRows('remMonthlyMoreRows')
  ]);
  leftY = pdfRemGroup(doc, leftX, leftY, colW, 'Annual Payout', [
    ['Variable / Performance Pay', data.remVariablePay], ['Leave Travel Allowance', data.remLTA],
    ...collectExtraBoxes('remAnnualExtra', 2), ...collectAddedRows('remAnnualMoreRows')
  ]);

  rightY = pdfRemGroup(doc, rightX, rightY, colW, 'Reimbursements & Perks', [
    ...collectExtraBoxes('remPerksExtra', 4), ...collectAddedRows('remPerksMoreRows')
  ]);
  rightY = pdfRemGroup(doc, rightX, rightY, colW, 'Company Car Details', [
    ...collectExtraBoxes('remCarExtra', 4), ...collectAddedRows('remCarMoreRows')
  ]);

  y = Math.max(leftY, rightY);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(11); doc.setTextColor(26,39,68);
  doc.text('Total Cost to Company: Rs. ' + (data.remTotalCTC || '________________') + ' / Annum', PDF_MARGIN, y + 4);
  y += 4;

  // ---------- Declaration (always its own separate page) ----------
  doc.addPage(); y = 20;
  y = pdfSectionTitle(doc, 'Declaration & Consent', y);

  function pdfBoxedParagraph(doc, y, heading, text){
    const paddingX = 5, paddingTop = 9, paddingBottom = 6;
    doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(text, PDF_CONTENT_W - paddingX * 2);
    const boxHeight = paddingTop + lines.length * 4.6 + paddingBottom;
    y = pdfPageBreakIfNeeded(doc, y, boxHeight + 8);
    doc.setDrawColor(180,176,166); doc.setLineWidth(0.35);
    doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, boxHeight);
    doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10.5); doc.setTextColor(26,39,68);
    doc.text(heading, PDF_MARGIN + paddingX, y + 6);
    doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9.5); doc.setTextColor(30,30,30);
    doc.text(lines, PDF_MARGIN + paddingX, y + paddingTop + 4);
    return y + boxHeight + 6;
  }

  const declText = "I shall, if and required, take up casual / temporary / permanent duty in the discharge of company assignments anywhere in India or abroad. I certify that the foregoing information is correct and complete to the best of my knowledge and belief and nothing has been concealed. I am not aware of any circumstances which might impair my fitness for employment. If at any time I am found to have concealed any material information or given any false details, my appointment shall be liable to summary termination without notice or compensation. I declare that I am not a relative of any Director/Employee of the company.";
  y = pdfBoxedParagraph(doc, y, 'Declaration', declText);

  const consentFullName = [data.firstName, data.middleName, data.surname].filter(Boolean).join(' ') || data.coverName || '________________________';
  y = pdfBoxedParagraphMixed(doc, y, 'Consent for Collection and Processing of Personal Data', [
    [
      { text: `I, ${consentFullName}`, bold: true },
      { text: "consent to SPR Auto Technologies Limited collecting, storing and processing my personal data and information mentioned and submitted in this form including IP Address, Photograph, Compensation details solely for the purpose of evaluation of my candidature for current or future employment opportunities with SPR Auto Technologies Limited or its group companies / subsidiaries and for conducting background verification (where applicable), and sharing relevant details or extracts from this form and my resume with the interview panel. I have provided the information in this form voluntarily and understand that providing incomplete or incorrect data may affect the Company's ability to process my job application and this data will not be shared with third parties except as necessary for the recruitment process or as required by law.", bold: false }
    ],
    [
      { text: "I additionally consent to my data being retained beyond this specific hiring process, for consideration against future roles at the Company, for a period not exceeding", bold: false },
      { text: "12 months", bold: true },
      { text: "from the date of submission of this consent.", bold: false }
    ],
    [
      { text: "I understand that I may withdraw this consent, or request access to, correction of, or erasure of my data (unless I am selected for employment) at any time by writing to the designated Data Protection Officer or HR team and that such withdrawal will not affect the lawfulness of processing carried out before withdrawal.", bold: false }
    ]
  ]);

  y = pdfPageBreakIfNeeded(doc, y, 16);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9.5); doc.setTextColor(30,30,30);
  const agreeText = (data.consentChecked ? '[X]' : '[ ]') + ' I have read and agree to the Declaration and the Consent for Collection and Processing of Personal Data above.';
  const agreeLines = doc.splitTextToSize(agreeText, PDF_CONTENT_W);
  doc.text(agreeLines, PDF_MARGIN, y);
  y += agreeLines.length * 4.6 + 8;

  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10);
  doc.text('Date & Time: ' + (data.submissionTimestamp || '-'), PDF_MARGIN, y);
  doc.text('Location: ' + (data.declLocation || '-'), PDF_MARGIN + 95, y);
  y += 8;
  doc.text('IP Address: ' + (data.submissionIP || 'Not available'), PDF_MARGIN, y);
  y += 9;
  const sigLines = doc.splitTextToSize('Signature: ' + (data.coverName || '-') + ' (submitted digitally)', PDF_CONTENT_W);
  doc.text(sigLines, PDF_MARGIN, y);

  pdfDrawOfficeUseOnlyPage(doc);

  return doc;
}

// ---------- Blank Print Template (hand-fill version, no candidate data) ----------
function generateBlankPdfTemplate(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  pdfFontFamily = 'helvetica';
  if (typeof MONTSERRAT_REGULAR_B64 !== 'undefined'){
    try {
      doc.addFileToVFS('Montserrat-Regular.ttf', MONTSERRAT_REGULAR_B64);
      doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
      doc.addFileToVFS('Montserrat-Bold.ttf', MONTSERRAT_BOLD_B64);
      doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
      pdfFontFamily = 'Montserrat';
    } catch(e){ pdfFontFamily = 'helvetica'; }
  }
  doc.setFont(pdfFontFamily, 'normal');
  pdfFillPageBackground(doc);
  doc.internal.events.subscribe('addPage', () => { pdfFillPageBackground(doc); });

  // ---------- Cover page ----------
  const logoH = 15;
  if (logoDataUrl){
    const logoW = logoH * (251 / 106);
    try { doc.addImage(logoDataUrl, 'PNG', PDF_MARGIN, 14, logoW, logoH); } catch(e){}
  }
  if (logo2DataUrl){
    const logo2W = logoH * (151 / 90);
    try { doc.addImage(logo2DataUrl, 'PNG', PDF_PAGE_W - PDF_MARGIN - logo2W, 14, logo2W, logoH); } catch(e){}
  }
  doc.setTextColor(26,39,68); doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(20);
  doc.text('SPR Auto Technologies Ltd.', PDF_PAGE_W / 2, 42, { align: 'center' });
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(11); doc.setTextColor(40,40,40);
  doc.text('PERSONAL DATA FORM — TO BE COMPLETED BY HAND IN BLOCK LETTERS', PDF_PAGE_W / 2, 49, { align: 'center' });
  doc.setDrawColor(40,40,40); doc.setLineWidth(0.8);
  doc.line(PDF_MARGIN, 55, PDF_PAGE_W - PDF_MARGIN, 55);

  const photoW = 38, photoH = 44.3;
  const photoX = PDF_PAGE_W - PDF_MARGIN - photoW, photoY = 64;
  doc.setDrawColor(130,130,130); doc.setLineWidth(0.4);
  doc.rect(photoX, photoY, photoW, photoH);
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9); doc.setTextColor(150,150,150);
  doc.text('RECENT', photoX + photoW / 2, photoY + photoH / 2 - 2, { align: 'center' });
  doc.text('PHOTOGRAPH', photoX + photoW / 2, photoY + photoH / 2 + 4, { align: 'center' });

  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(12); doc.setTextColor(26,39,68);
  doc.text('Full Name:', PDF_MARGIN, 78);
  doc.setDrawColor(140,140,140); doc.setLineWidth(0.3);
  doc.line(PDF_MARGIN + 30, 79, 150, 79);

  doc.text('Post Applied For:', PDF_MARGIN, 92);
  doc.line(PDF_MARGIN + 40, 93, 150, 93);

  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10); doc.setTextColor(80,80,80);
  doc.text('Please note:', PDF_MARGIN, 112);
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9.5); doc.setTextColor(90,90,90);
  const noteLines = doc.splitTextToSize('Please complete this form in your own handwriting, in block letters. Please answer all questions completely; if necessary, attach a separate sheet and add any additional information which may be relevant. Please do not enclose any certificate or other document; enclosures will not be returned.', 135);
  doc.text(noteLines, PDF_MARGIN, 119);

  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10); doc.setTextColor(90,90,90);
  doc.text('Ref:', PDF_PAGE_W - PDF_MARGIN - 45, 285);
  doc.setDrawColor(140,140,140); doc.setLineWidth(0.3);
  doc.line(PDF_PAGE_W - PDF_MARGIN - 35, 286, PDF_PAGE_W - PDF_MARGIN, 286);

  // ---------- Personal Particulars ----------
  doc.addPage(); let y = 20;
  y = pdfSectionTitle(doc, 'Personal Particulars', y);
  y = pdfTemplateFieldGrid(doc, y, [
    'Full Name (Surname, First, Middle)', 'Present Address', 'Mobile / Alternate Mobile',
    'Permanent Address', 'Email', 'Emergency Contact - Relation & Name', 'Emergency Contact - Mobile Number',
    "Mother's Name", "Father's Name", "Spouse's Name",
    'Date of Birth', 'Age', 'Place of Birth / Origin'
  ], 76, ['Present Address', 'Permanent Address']);
  const residenceBlankRows = Array.from({ length: 5 }, () => ({}));
  const familyBlankRows = Array.from({ length: 5 }, () => ({}));
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Residence History (Last 5 Years)', rows: residenceBlankRows, columns: [
      {key:'from', label:'From'}, {key:'to', label:'To'}, {key:'address', label:'Address'},
      {key:'reason', label:'Reason'}, {key:'referee', label:'Referee'}
    ] },
    { title: 'Family Details / Dependents', rows: familyBlankRows, columns: [
      {key:'relationship', label:'Relationship'}, {key:'age', label:'Age'}, {key:'occupation', label:'Occupation / Reason for Dependency'}
    ] }
  ]);

  // ---------- Other Particulars ----------
  y = pdfTemplateFieldGrid(doc, y, [
    'Other Income Source / Amount', 'Court Proceedings', 'Height / Weight', 'Illness / Disability'
  ]);
  const orgBlankRows = Array.from({ length: 5 }, () => ({}));
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Organisation Memberships', rows: orgBlankRows, columns: [
      {key:'org', label:'Organisation'}, {key:'nature', label:'Nature of Association'}
    ] }
  ]);

  // ---------- Qualifications ----------
  doc.addPage(); y = 20;
  y = pdfDataTable(doc, y, 'Educational History', [], [
    {key:'institution', label:'Institution'}, {key:'university', label:'University'}, {key:'entering', label:'Entering'},
    {key:'leaving', label:'Leaving'}, {key:'degree', label:'Degree/Exam'}, {key:'subjects', label:'Subjects'}, {key:'marks', label:'Marks %'}
  ], 6, 10.5, {
    0: { cellWidth: 33 }, 1: { cellWidth: 31 }, 2: { cellWidth: 18 }, 3: { cellWidth: 18 },
    4: { cellWidth: 30 }, 5: { cellWidth: 36 }, 6: { cellWidth: 14 }
  });
  y = pdfTemplateFieldGrid(doc, y, ['Professional Societies', 'Honours / Scholarships', 'Publications / Paper / Thesis']);
  y = pdfDataTable(doc, y, 'Training Attended', [], [
    {key:'name', label:'Training'}, {key:'duration', label:'Duration'}, {key:'faculty', label:'Faculty'}, {key:'content', label:'Content'}
  ], 2);
  y = pdfDataTable(doc, y, 'Languages Known', [], [
    {key:'language', label:'Language'}, {key:'speak', label:'Speak'}, {key:'read', label:'Read'}, {key:'write', label:'Write'}
  ], 3);

  // ---------- Experience ----------
  doc.addPage(); y = 20;
  y = pdfTemplateFieldGrid(doc, y, ['Extra-Curricular (Arts / Social / Sports / Hobbies)']);
  const empBlank = Array.from({ length: 6 }, (_, i) => ({ sno: (i === 0 ? '1 (Present)' : String(i + 1)) }));
  const respBlank = Array.from({ length: 6 }, (_, i) => ({ sno: String(i + 1) }));
  y = pdfFillRemainingHeight(doc, y, [
    { title: 'Past Employment', rows: empBlank, columns: [
      {key:'sno', label:'S.No.'}, {key:'employer', label:'Employer'}, {key:'from', label:'From'}, {key:'to', label:'To'},
      {key:'basic', label:'Basic'}, {key:'total', label:'Total'}, {key:'reason', label:'Reason for Leaving'}
    ], columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 56 }, 2: { cellWidth: 19 }, 3: { cellWidth: 19 },
      4: { cellWidth: 19 }, 5: { cellWidth: 19 }, 6: { cellWidth: 34 }
    } },
    { title: 'Designation / Responsibilities', rows: respBlank, columns: [
      {key:'sno', label:'S.No.'}, {key:'responsibilities', label:'Responsibilities'}, {key:'supervisor', label:'Supervisor'}
    ], columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 121 }, 2: { cellWidth: 45 }
    } }
  ]);

  // ---------- References ----------
  doc.addPage(); y = 20;
  y = pdfDataTable(doc, y, 'Employees of Our Units Known to You', [], [
    {key:'name', label:'Name'}, {key:'rank', label:'Rank'}, {key:'unit', label:'Unit'}, {key:'dept', label:'Deptt.'}, {key:'relation', label:'Relationship'}
  ], 2);
  y = pdfDataTable(doc, y, 'Referees (Not Related)', [], [
    {key:'name', label:'Name'}, {key:'occupation', label:'Occupation'}, {key:'contact', label:'Address/Phone'}
  ], 2);
  y = pdfDataTable(doc, y, 'Responsible Persons of Your Locality', [], [
    {key:'name', label:'Name'}, {key:'occupation', label:'Occupation'}, {key:'contact', label:'Address/Phone'}
  ], 2);
  y = pdfTemplateFieldGrid(doc, y, ['Notice Period Required', 'Appeared for Test/Interview Earlier', 'How Applied']);

  // ---------- Remuneration (always its own page, compact two-column layout) ----------
  doc.addPage(); y = 20;
  y = pdfSectionTitle(doc, 'Present Remuneration / Facilities (if currently employed)', y);
  const colGap = 8, colW = (PDF_CONTENT_W - colGap) / 2;
  const leftX = PDF_MARGIN, rightX = PDF_MARGIN + colW + colGap;
  let leftY = y, rightY = y;
  leftY = pdfTemplateRemGroup(doc, leftX, leftY, colW, 'Monthly Salary Slip', ['Basic','HRA','Conveyance','Medical Allowance','Other Allowances','PF','','','','','','','']);
  leftY = pdfTemplateRemGroup(doc, leftX, leftY, colW, 'Annual Payout', ['Variable / Performance Pay','Leave Travel Allowance','','','','','']);
  rightY = pdfTemplateRemGroup(doc, rightX, rightY, colW, 'Reimbursements & Perks', new Array(11).fill(''));
  rightY = pdfTemplateRemGroup(doc, rightX, rightY, colW, 'Company Car Details', new Array(11).fill(''));
  y = Math.max(leftY, rightY);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(11); doc.setTextColor(26,39,68);
  doc.text('Total Cost to Company: Rs. _______________________ / Annum', PDF_MARGIN, y + 4);

  // ---------- Declaration (always its own page) ----------
  doc.addPage(); y = 20;
  y = pdfSectionTitle(doc, 'Declaration & Consent', y);

  const declText = "I shall, if and required, take up casual / temporary / permanent duty in the discharge of company assignments anywhere in India or abroad. I certify that the foregoing information is correct and complete to the best of my knowledge and belief and nothing has been concealed. I am not aware of any circumstances which might impair my fitness for employment. If at any time I am found to have concealed any material information or given any false details, my appointment shall be liable to summary termination without notice or compensation. I declare that I am not a relative of any Director/Employee of the company.";
  y = pdfBoxedParagraphStatic(doc, y, 'Declaration', declText);

  y = pdfBoxedParagraphMixed(doc, y, 'Consent for Collection and Processing of Personal Data', [
    [
      { text: 'I, ________________________________', bold: true },
      { text: "consent to SPR Auto Technologies Limited collecting, storing and processing my personal data and information mentioned and submitted in this form including IP Address, Photograph, Compensation details solely for the purpose of evaluation of my candidature for current or future employment opportunities with SPR Auto Technologies Limited or its group companies / subsidiaries and for conducting background verification (where applicable), and sharing relevant details or extracts from this form and my resume with the interview panel. I have provided the information in this form voluntarily and understand that providing incomplete or incorrect data may affect the Company's ability to process my job application and this data will not be shared with third parties except as necessary for the recruitment process or as required by law.", bold: false }
    ],
    [
      { text: "I additionally consent to my data being retained beyond this specific hiring process, for consideration against future roles at the Company, for a period not exceeding", bold: false },
      { text: "12 months", bold: true },
      { text: "from the date of submission of this consent.", bold: false }
    ],
    [
      { text: "I understand that I may withdraw this consent, or request access to, correction of, or erasure of my data (unless I am selected for employment) at any time by writing to the designated Data Protection Officer or HR team and that such withdrawal will not affect the lawfulness of processing carried out before withdrawal.", bold: false }
    ]
  ]);

  y = pdfPageBreakIfNeeded(doc, y, 16);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9.5); doc.setTextColor(30,30,30);
  const agreeLines = doc.splitTextToSize('[  ]  I have read and agree to the Declaration and the Consent for Collection and Processing of Personal Data above.', PDF_CONTENT_W);
  doc.text(agreeLines, PDF_MARGIN, y);
  y += agreeLines.length * 4.6 + 10;

  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10);
  doc.text('Date: _______________________', PDF_MARGIN, y);
  doc.text('Location: _______________________', PDF_MARGIN + 95, y);
  y += 16;
  doc.text('Signature: _______________________________________', PDF_MARGIN, y);

  pdfDrawOfficeUseOnlyPage(doc);

  return doc;
}

// Shared helper: boxed paragraph with static (non-data-driven) text, used by the blank template
function pdfBoxedParagraphStatic(doc, y, heading, text){
  const paddingX = 5, paddingTop = 9, paddingBottom = 6;
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(text, PDF_CONTENT_W - paddingX * 2);
  const boxHeight = paddingTop + lines.length * 4.6 + paddingBottom;
  y = pdfPageBreakIfNeeded(doc, y, boxHeight + 8);
  doc.setDrawColor(180,176,166); doc.setLineWidth(0.35);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, boxHeight);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10.5); doc.setTextColor(26,39,68);
  doc.text(heading, PDF_MARGIN + paddingX, y + 6);
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(9.5); doc.setTextColor(30,30,30);
  doc.text(lines, PDF_MARGIN + paddingX, y + paddingTop + 4);
  return y + boxHeight + 6;
}

// Word-wraps a paragraph made of {text, bold} segments (so part of a paragraph can render in
// bold while the rest stays normal weight) into an array of lines, each line an array of
// {text, bold} word-tokens.
function pdfWrapMixedWords(doc, segments, maxWidth, fontSize){
  const words = [];
  segments.forEach(seg => {
    String(seg.text).split(' ').forEach(w => { if (w.length) words.push({ text: w, bold: !!seg.bold }); });
  });
  const scale = doc.internal.scaleFactor;
  function widthOf(text, bold){
    doc.setFont(pdfFontFamily, bold ? 'bold' : 'normal');
    return doc.getStringUnitWidth(text) * fontSize / scale;
  }
  const spaceWidth = widthOf(' ', false);
  const lines = [];
  let line = [], lineWidth = 0;
  words.forEach(word => {
    const wWidth = widthOf(word.text, word.bold);
    const extra = (line.length ? spaceWidth : 0) + wWidth;
    if (lineWidth + extra > maxWidth && line.length){
      lines.push(line);
      line = [word]; lineWidth = wWidth;
    } else {
      lineWidth += extra;
      line.push(word);
    }
  });
  if (line.length) lines.push(line);
  return lines;
}

// Draws lines produced by pdfWrapMixedWords, switching font weight per word as needed.
function pdfDrawMixedLines(doc, lines, x, y, fontSize, lineH){
  const scale = doc.internal.scaleFactor;
  lines.forEach(line => {
    let cx = x;
    line.forEach(word => {
      doc.setFont(pdfFontFamily, word.bold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      doc.text(word.text, cx, y);
      cx += doc.getStringUnitWidth(word.text) * fontSize / scale;
      cx += doc.getStringUnitWidth(' ') * fontSize / scale;
    });
    y += lineH;
  });
  return y;
}

// Same bordered-box visual language as pdfBoxedParagraph(Static), but supports selectively
// bolding parts of the text (e.g. the candidate's name, "12 months") without bolding the
// whole paragraph. paragraphs: array of paragraphs, each an array of {text, bold} segments.
function pdfBoxedParagraphMixed(doc, y, heading, paragraphs){
  const paddingX = 5, paddingTop = 9, paddingBottom = 6, fontSize = 9.5, lineH = 4.6;
  const maxWidth = PDF_CONTENT_W - paddingX * 2;
  const wrapped = paragraphs.map(p => pdfWrapMixedWords(doc, p, maxWidth, fontSize));
  const totalLines = wrapped.reduce((sum, lines) => sum + lines.length, 0) + (wrapped.length - 1);
  const boxHeight = paddingTop + totalLines * lineH + paddingBottom;
  y = pdfPageBreakIfNeeded(doc, y, boxHeight + 8);
  doc.setDrawColor(180,176,166); doc.setLineWidth(0.35);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, boxHeight);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10.5); doc.setTextColor(26,39,68);
  doc.text(heading, PDF_MARGIN + paddingX, y + 6);
  doc.setTextColor(30,30,30);
  let cy = y + paddingTop + 4;
  wrapped.forEach((lines, idx) => {
    cy = pdfDrawMixedLines(doc, lines, PDF_MARGIN + paddingX, cy, fontSize, lineH);
    if (idx < wrapped.length - 1) cy += lineH;
  });
  return y + boxHeight + 6;
}

// Same bordered-box visual language as pdfBoxedParagraphStatic, but with blank ruled lines
// for handwritten notes instead of printed text — used for internal/office-use sections.
// Appends the internal "For Office Use Only" interview/decision record as the final page.
// Matches the ORIGINAL form's exact single-page, two-column layout (interview rounds beside
// the Interview Board, not stacked below it) — restyled with this document's color palette
// and font for visual consistency, but the structure/format is unchanged from the original.
// Never shown to or filled by the candidate — appended automatically at PDF-generation time.
function pdfDrawOfficeUseOnlyPage(doc){
  doc.addPage();
  const navy = [26,39,68], boxBorder = [180,176,166], ruleLine = [205,200,188];

  // Test Score box — top right, above the title
  const tsW = 46, tsH = 13, tsX = PDF_PAGE_W - PDF_MARGIN - tsW, tsY = 10;
  doc.setDrawColor(...boxBorder); doc.setLineWidth(0.4);
  doc.rect(tsX, tsY, tsW, tsH);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(8.5); doc.setTextColor(...navy);
  doc.text('TEST SCORE:', tsX + 3, tsY + 6);

  let y = 26;
  y = pdfSectionTitle(doc, 'For Office Use Only', y);
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(8); doc.setTextColor(130,130,130);
  doc.text('Internal use by the interview panel and HR only — not to be completed by the candidate.', PDF_MARGIN, y);
  y += 7;

  // ---- Main grid: Interview Rounds (left) beside Interview Board (right) ----
  // Round heights mirror the original paper form's proportions — 1st Round gets the
  // most writing space, 2nd Round the least, Final Round in between — rather than
  // splitting the grid evenly three ways. Each round's writing area (left) is left
  // blank (no ruled lines). The Interview Board (right) is divided into its own set
  // of bordered boxes PER ROUND — 6 in 1st Round, 3 in 2nd Round, 4 in Final Round —
  // matching the original form exactly, rather than one continuous line grid.
  const dividerX = PDF_MARGIN + PDF_CONTENT_W * 0.62;
  const rightColX = dividerX + 4;
  const rightEdge = PDF_MARGIN + PDF_CONTENT_W;
  const rounds = [
    { label: '1st Round', h: 50, boardBoxes: 6 },
    { label: '2nd Round', h: 20, boardBoxes: 3 },
    { label: 'Final Round', h: 32, boardBoxes: 4 }
  ];
  const gridTop = y, gridHeight = rounds.reduce((sum, r) => sum + r.h, 0);

  doc.setDrawColor(...boxBorder); doc.setLineWidth(0.4);
  doc.rect(PDF_MARGIN, gridTop, PDF_CONTENT_W, gridHeight);
  doc.line(dividerX, gridTop, dividerX, gridTop + gridHeight);

  let ry = gridTop;
  rounds.forEach((r, i) => {
    // Round divider spans the FULL width (both columns), so each round's Interview
    // Board boxes are bounded top/bottom within that round's own segment.
    if (i > 0){ doc.setDrawColor(...boxBorder); doc.setLineWidth(0.3); doc.line(PDF_MARGIN, ry, rightEdge, ry); }
    doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9); doc.setTextColor(...navy);
    doc.text(r.label, PDF_MARGIN + 4, ry + 6);
    doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(7.8); doc.setTextColor(90,90,90);
    doc.text('DATE _______________     SIGNATURE _______________', PDF_MARGIN + 4, ry + r.h - 4);
    if (i === 0){
      doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(9); doc.setTextColor(...navy);
      doc.text('INTERVIEW BOARD', rightColX, ry + 6);
    }
    // This round's Interview Board boxes: boardBoxes rows evenly spaced within [ry, ry+r.h],
    // starting below the header row on the 1st Round only.
    const boxesTop = ry + (i === 0 ? 11 : 0);
    const boxesBottom = ry + r.h;
    const rowH = (boxesBottom - boxesTop) / r.boardBoxes;
    doc.setDrawColor(...ruleLine); doc.setLineWidth(0.2);
    for (let b = 1; b < r.boardBoxes; b++){
      const ly = boxesTop + b * rowH;
      doc.line(rightColX - 4, ly, rightEdge, ly);
    }
    ry += r.h;
  });

  y = gridTop + gridHeight + 7;

  // ---- Special Interview Notes ---- (blank writing area, no ruled lines, matching original)
  const notesH = 26;
  doc.setDrawColor(...boxBorder); doc.setLineWidth(0.4);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, notesH);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10); doc.setTextColor(...navy);
  doc.text('SPECIAL INTERVIEW NOTES (IF ANY)', PDF_PAGE_W / 2, y + 6, { align: 'center' });
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(7.8); doc.setTextColor(90,90,90);
  doc.text('DATE _____________     SIGNATURE _____________     _____________     _____________', PDF_MARGIN + 4, y + notesH - 4);

  y += notesH + 7;

  // ---- Decision ----
  // Box stretches to the page's usual bottom margin (matching every other page in this
  // document), leaving a large blank gap between the Terms list and the Date/Signature
  // footer at the very bottom — matching the original form.
  const termsSubItems = [
    'Rank / Designation',
    'Salary / Add. Benefits ( if any)',
    'Date of joining',
    'Notice Period Salary ( Yes / No)'
  ];
  const decisionH = 280 - y;
  const dashX = PDF_MARGIN + 100; // fixed column for the short trailing answer-dash, clear of the longest sub-item label

  doc.setDrawColor(...boxBorder); doc.setLineWidth(0.4);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, decisionH);
  doc.setFont(pdfFontFamily,'bold'); doc.setFontSize(10); doc.setTextColor(...navy);
  doc.text('DECISION', PDF_PAGE_W / 2, y + 7, { align: 'center' });

  let dy = y + 15;
  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(8.5); doc.setTextColor(30,30,30);
  doc.text('Issue appointment letter as under', PDF_MARGIN + 4, dy);
  dy += 6;

  doc.text('— Unit of placement', PDF_MARGIN + 4, dy);
  dy += 6;

  // "Terms" shares its line with the first sub-item, matching the original layout;
  // each sub-item carries a short trailing dash (an answer blank) at a fixed column
  // rather than a full-width line.
  doc.text('— Terms', PDF_MARGIN + 4, dy);
  doc.text('- ' + termsSubItems[0], PDF_MARGIN + 28, dy);
  doc.text('—', dashX, dy);
  dy += 6;
  termsSubItems.slice(1).forEach(sub => {
    doc.text('- ' + sub, PDF_MARGIN + 28, dy);
    doc.text('—', dashX, dy);
    dy += 6;
  });

  doc.setFont(pdfFontFamily,'normal'); doc.setFontSize(7.8); doc.setTextColor(90,90,90);
  doc.text('DATE _______________', PDF_MARGIN + 4, y + decisionH - 8);
  doc.text('SIGNATURE _______________', PDF_MARGIN + 95, y + decisionH - 8);
}

// ---------- Submit / Preview flow ----------
let pendingDoc = null, pendingFileName = null, pendingBlobUrl = null;

document.getElementById('submitBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('statusMsg');
  const errEl = document.getElementById('errMsg');
  statusEl.style.display = 'none'; errEl.style.display = 'none';

  const form = document.getElementById('dataForm');
  const missingFields = findMissingRequiredFields();
  if (missingFields.length){
    highlightMissingFields(missingFields);
    const firstStep = Math.min(...missingFields.map(stepOfElement));
    goToStep(firstStep);
    errEl.textContent = 'Please fill in all mandatory fields — highlighted in yellow — before previewing your application.';
    errEl.style.display = 'block';
    const firstMissingOnStep = missingFields.find(el => stepOfElement(el) === firstStep) || missingFields[0];
    if (firstMissingOnStep.scrollIntoView) firstMissingOnStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstMissingOnStep.focus({ preventScroll: true });
    return;
  }
  if (!form.checkValidity()){
    form.reportValidity();
    return;
  }
  if (!document.getElementById('consentCheck').checked){
    errEl.textContent = 'Please read and accept the consent statement before submitting.';
    errEl.style.display = 'block';
    return;
  }
  const data = collectFormData();
  if (!data.photoDataUrl){
    errEl.textContent = 'Please upload a photograph before submitting.';
    errEl.style.display = 'block';
    goToStep(0);
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true; submitBtn.textContent = 'Preparing…';
  if (!clientIP) { clientIP = await fetchClientIP(); }
  data.submissionIP = clientIP;
  submitBtn.disabled = false; submitBtn.textContent = originalLabel;

  try {
    const doc = generatePdf(data);
    const candidateName = [data.firstName, data.surname].filter(Boolean).join(' ') || data.coverName || 'Candidate';
    const safeName = candidateName.replace(/[\/\\:*?"<>|]+/g, '').trim();
    const fileName = 'SPRATL-' + safeName + '.pdf';

    pendingDoc = doc;
    pendingFileName = fileName;
    if (pendingBlobUrl) URL.revokeObjectURL(pendingBlobUrl);
    pendingBlobUrl = doc.output('bloburl');

    document.getElementById('previewFrame').src = pendingBlobUrl;
    document.getElementById('previewOverlay').classList.add('active');
  } catch (e){
    console.error(e);
    errEl.textContent = 'Something went wrong generating the PDF. Please try again, or contact HR directly if the problem persists.';
    errEl.style.display = 'block';
  }
});

document.getElementById('closePreviewBtn').addEventListener('click', () => {
  document.getElementById('previewOverlay').classList.remove('active');
});

document.getElementById('confirmSendBtn').addEventListener('click', () => {
  if (!pendingDoc) return;
  const statusEl = document.getElementById('statusMsg');
  pendingDoc.save(pendingFileName);
  statusEl.innerHTML = 'PDF downloaded as <strong>' + pendingFileName + '</strong> to your device. Please email it to <strong>' + HR_EMAIL + '</strong> yourself as an attachment.';
  statusEl.style.display = 'block';
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('previewOverlay').classList.remove('active');
});

// ---------- Live Date & Time display on Declaration step ----------
function updateTimestampDisplay(){
  const el = document.getElementById('timestampDisplay');
  if (!el) return;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,'0');
  const mm = String(now.getMonth() + 1).padStart(2,'0');
  const yyyy = now.getFullYear();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  el.textContent = `${dd}-${mm}-${yyyy}, ${timeStr}`;
}
updateTimestampDisplay();
setInterval(updateTimestampDisplay, 30000);

// ---------- PWA install banner + service worker ----------
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
window.addEventListener('beforeinstallprompt', (e) => {
  document.getElementById('installBanner').style.display = 'block';
});
