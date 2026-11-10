// Static controls are bound once from trusted application code.
uiBindStatic([
["click", "s0", function (event, uiValues) {
  saveFbConfig();
}],
["keydown", "s1", function (event, uiValues) {
  if (event.key === 'Enter') document.getElementById('li-pw').focus();
}],
["keydown", "s2", function (event, uiValues) {
  if (event.key === 'Enter') doLogin();
}],
["click", "s3", function (event, uiValues) {
  doLogin();
}],
["click", "s4", function (event, uiValues) {
  switchAuthMode('signup');
}],
["keydown", "s5", function (event, uiValues) {
  if (event.key === 'Enter') submitSignup();
}],
["keydown", "s6", function (event, uiValues) {
  if (event.key === 'Enter') submitSignup();
}],
["click", "s7", function (event, uiValues) {
  submitSignup();
}],
["click", "s8", function (event, uiValues) {
  switchAuthMode('login');
}],
["click", "s9", function (event, uiValues) {
  setOrderBasis('order');
}],
["click", "s10", function (event, uiValues) {
  setOrderBasis('ship');
}],
["click", "s11", function (event, uiValues) {
  showPage('sales', this);
}],
["click", "s12", function (event, uiValues) {
  toggleNavGroup(this);
}],
["click", "s13", function (event, uiValues) {
  showStatsChannel('office', this);
}],
["click", "s14", function (event, uiValues) {
  showStatsChannel('dist', this);
}],
["click", "s15", function (event, uiValues) {
  showPage('products', this);
}],
["click", "s16", function (event, uiValues) {
  showPage('cost', this);
}],
["click", "s17", function (event, uiValues) {
  showPage('compare', this);
}],
["click", "s18", function (event, uiValues) {
  showPage('deep', this);
}],
["click", "s19", function (event, uiValues) {
  showPage('dash', this);
}],
["click", "s20", function (event, uiValues) {
  showPage('field', this);
}],
["click", "s21", function (event, uiValues) {
  toggleNavGroup(this);
}],
["click", "s22", function (event, uiValues) {
  showPage('input', this);
}],
["click", "s23", function (event, uiValues) {
  showPage('weekly', this);
}],
["click", "s24", function (event, uiValues) {
  showPage('mo-plan', this);
}],
["click", "s25", function (event, uiValues) {
  showPage('mo-settle', this);
}],
["click", "s26", function (event, uiValues) {
  showPage('grade', this);
}],
["click", "s27", function (event, uiValues) {
  showPage('clients', this);
}],
["click", "s28", function (event, uiValues) {
  showPage('project', this);
}],
["click", "s29", function (event, uiValues) {
  showPage('users', this);
}],
["click", "s30", function (event, uiValues) {
  showPage('targets', this);
}],
["click", "s31", function (event, uiValues) {
  openModal('modal-change-pw');
}],
["click", "s32", function (event, uiValues) {
  doLogout();
}],
["click", "s33", function (event, uiValues) {
  closeMobMenu();
}],
["click", "s34", function (event, uiValues) {
  toggleMobMenu();
}],
["click", "s35", function (event, uiValues) {
  showPage('notice');
}],
["click", "s36", function (event, uiValues) {
  openTopbarLatestNotice();
}],
["keydown", "s37", function (event, uiValues) {
  if (event.key === 'Enter' || event.key === ' ') openTopbarLatestNotice();
}],
["click", "s38", function (event, uiValues) {
  openGlobalSearch();
}],
["click", "s39", function (event, uiValues) {
  toggleAlertPanel();
}],
["click", "s40", function (event, uiValues) {
  shiftSalesMonth('summary', -1);
}],
["click", "s41", function (event, uiValues) {
  shiftSalesMonth('summary', 1);
}],
["click", "s42", function (event, uiValues) {
  shiftSalesMonth('trend', -1);
}],
["click", "s43", function (event, uiValues) {
  shiftSalesMonth('trend', 1);
}],
["click", "s44", function (event, uiValues) {
  setSalesTrendMode('amount');
}],
["click", "s45", function (event, uiValues) {
  setSalesTrendMode('flow');
}],
["click", "s46", function (event, uiValues) {
  setSalesTrendMode('share');
}],
["click", "s47", function (event, uiValues) {
  shiftSalesMonth('office', -1);
}],
["click", "s48", function (event, uiValues) {
  shiftSalesMonth('office', 1);
}],
["click", "s49", function (event, uiValues) {
  downloadShRankExcel('office');
}],
["click", "s50", function (event, uiValues) {
  shiftSalesMonth('dist', -1);
}],
["click", "s51", function (event, uiValues) {
  shiftSalesMonth('dist', 1);
}],
["click", "s52", function (event, uiValues) {
  shiftSalesMonth('person', -1);
}],
["click", "s53", function (event, uiValues) {
  shiftSalesMonth('person', 1);
}],
["click", "s54", function (event, uiValues) {
  showDashTab('status');
}],
["click", "s55", function (event, uiValues) {
  showDashTab('insight');
}],
["click", "s56", function (event, uiValues) {
  dlyCalMove(-1);
}],
["click", "s57", function (event, uiValues) {
  dlyCalMove(1);
}],
["click", "s58", function (event, uiValues) {
  dlyCalToday();
}],
["click", "s59", function (event, uiValues) {
  dlyBackToCal();
}],
["click", "s60", function (event, uiValues) {
  cwFinish();
}],
["input", "s61", function (event, uiValues) {
  cwAcSearch();
}],
["focus", "s62", function (event, uiValues) {
  cwAcSearch();
}],
["blur", "s63", function (event, uiValues) {
  setTimeout(() => {
    cwAcClose();
  }, 250);
}],
["keydown", "s64", function (event, uiValues) {
  cwAcKeydown(event);
}],
["click", "s65", function (event, uiValues) {
  cwSetDeal('○');
}],
["click", "s66", function (event, uiValues) {
  cwSetDeal('△');
}],
["click", "s67", function (event, uiValues) {
  cwSetDeal('×');
}],
["click", "s68", function (event, uiValues) {
  cwCancelEdit();
}],
["click", "s69", function (event, uiValues) {
  cwSaveCard();
}],
["click", "s70", function (event, uiValues) {
  wkOpenForm();
}],
["change", "s71", function (event, uiValues) {
  wkRenderList();
}],
["click", "s72", function (event, uiValues) {
  wkFormPrev();
}],
["click", "s73", function (event, uiValues) {
  wkFormNext();
}],
["click", "s74", function (event, uiValues) {
  wkCloseForm();
}],
["input", "s75", function (event, uiValues) {
  wkCalcNextTarget();
}],
["input", "s76", function (event, uiValues) {
  wkCalcNextTarget();
}],
["input", "s77", function (event, uiValues) {
  wkCalcNextTarget();
}],
["input", "s78", function (event, uiValues) {
  wkHlSearch(this.value);
}],
["keydown", "s79", function (event, uiValues) {
  if (event.key === 'Escape') wkHlCloseDrop();
}],
["click", "s80", function (event, uiValues) {
  wkHlAddRow(document.getElementById('wk-hl-search').value.trim());
  document.getElementById('wk-hl-search').value = '';
  wkHlCloseDrop();
}],
["change", "s81", function (event, uiValues) {
  wkAddFiles(this);
}],
["click", "s82", function (event, uiValues) {
  wkCloseForm();
}],
["click", "s83", function (event, uiValues) {
  wkSaveReport();
}],
["click", "s84", function (event, uiValues) {
  moPlanOpenForm();
}],
["change", "s85", function (event, uiValues) {
  moPlanRenderList();
}],
["click", "s86", function (event, uiValues) {
  moChange(-1);
}],
["click", "s87", function (event, uiValues) {
  moChange(1);
}],
["click", "s88", function (event, uiValues) {
  moPlanCloseForm();
}],
["input", "s89", function (event, uiValues) {
  moCalcTargetVisit();
}],
["input", "s90", function (event, uiValues) {
  moCalcTargetVisit();
}],
["input", "s91", function (event, uiValues) {
  moCalcTargetVisit();
}],
["click", "s92", function (event, uiValues) {
  moAddPlanRow();
}],
["click", "s93", function (event, uiValues) {
  moAddPlanRows(5);
}],
["click", "s94", function (event, uiValues) {
  moSavePlan();
}],
["click", "s95", function (event, uiValues) {
  moSettleOpenForm();
}],
["change", "s96", function (event, uiValues) {
  moSettleRenderList();
}],
["click", "s97", function (event, uiValues) {
  moChange(-1);
}],
["click", "s98", function (event, uiValues) {
  moChange(1);
}],
["click", "s99", function (event, uiValues) {
  moSettleCloseForm();
}],
["click", "s100", function (event, uiValues) {
  moSaveSettle();
}],
["input", "s101", function (event, uiValues) {
  renderRecords();
}],
["change", "s102", function (event, uiValues) {
  renderRecords();
}],
["change", "s103", function (event, uiValues) {
  renderRecords();
}],
["change", "s104", function (event, uiValues) {
  renderRecords();
}],
["click", "s105", function (event, uiValues) {
  drpOpen('records');
}],
["click", "s106", function (event, uiValues) {
  openLoginLogs();
}],
["click", "s107", function (event, uiValues) {
  openAddUserModal();
}],
["click", "s108", function (event, uiValues) {
  saveTargets();
}],
["input", "s109", function (event, uiValues) {
  fmtComma(this);
}],
["input", "s110", function (event, uiValues) {
  fmtComma(this);
}],
["click", "s111", function (event, uiValues) {
  exportClients();
}],
["click", "s112", function (event, uiValues) {
  openModal('modal-client-upload');
}],
["click", "s113", function (event, uiValues) {
  openAddClientModal();
}],
["input", "s114", function (event, uiValues) {
  renderClients();
}],
["change", "s115", function (event, uiValues) {
  renderClients();
}],
["change", "s116", function (event, uiValues) {
  renderClients();
}],
["change", "s117", function (event, uiValues) {
  renderClients();
}],
["change", "s118", function (event, uiValues) {
  renderClients();
}],
["click", "s119", function (event, uiValues) {
  exportSelectedClients();
}],
["click", "s120", function (event, uiValues) {
  deleteSelectedClients();
}],
["click", "s121", function (event, uiValues) {
  clearClientSelection();
}],
["click", "s122", function (event, uiValues) {
  drpOpen('stats');
}],
["click", "s123", function (event, uiValues) {
  showStatsTab('summary');
}],
["click", "s124", function (event, uiValues) {
  showStatsTab('product');
}],
["click", "s125", function (event, uiValues) {
  showStatsTab('person');
}],
["click", "s126", function (event, uiValues) {
  showStatsTab('client');
}],
["change", "s127", function (event, uiValues) {
  renderRevisit();
}],
["click", "s128", function (event, uiValues) {
  openModal('modal-add-notice');
}],
["click", "s129", function (event, uiValues) {
  drpOpen('prod');
}],
["input", "s130", function (event, uiValues) {
  renderProducts();
}],
["click", "s131", function (event, uiValues) {
  setProductCategory('all');
}],
["click", "s132", function (event, uiValues) {
  showProdTab2('portfolio');
}],
["click", "s133", function (event, uiValues) {
  showProdTab2('spread');
}],
["click", "s134", function (event, uiValues) {
  showProdTab2('risk');
}],
["click", "s135", function (event, uiValues) {
  showProdTab2('inventory');
}],
["click", "s136", function (event, uiValues) {
  showProdTab2('list');
}],
["click", "s137", function (event, uiValues) {
  prodSortBy('name');
}],
["click", "s138", function (event, uiValues) {
  prodSortBy('category');
}],
["click", "s139", function (event, uiValues) {
  prodSortBy('qty');
}],
["click", "s140", function (event, uiValues) {
  prodSortBy('sales');
}],
["click", "s141", function (event, uiValues) {
  prodSortBy('clientCount');
}],
["change", "s142", function (event, uiValues) {
  renderProdAbc();
}],
["change", "s143", function (event, uiValues) {
  renderProdAbc();
}],
["click", "s144", function (event, uiValues) {
  setDeepChannel('office');
}],
["click", "s145", function (event, uiValues) {
  setDeepChannel('dist');
}],
["click", "s146", function (event, uiValues) {
  showDeepTab('bridge');
}],
["click", "s147", function (event, uiValues) {
  showDeepTab('cohort');
}],
["click", "s148", function (event, uiValues) {
  showDeepTab('rfm');
}],
["click", "s149", function (event, uiValues) {
  showDeepTab('cross');
}],
["click", "s150", function (event, uiValues) {
  showDeepTab('price');
}],
["change", "s151", function (event, uiValues) {
  renderDeep();
}],
["click", "s152", function (event, uiValues) {
  setCmpMode('period');
}],
["click", "s153", function (event, uiValues) {
  setCmpMode('person');
}],
["click", "s154", function (event, uiValues) {
  setCmpMode('channel');
}],
["change", "s155", function (event, uiValues) {
  renderCompare();
}],
["change", "s156", function (event, uiValues) {
  renderCompare();
}],
["click", "s157", function (event, uiValues) {
  renderField();
}],
["click", "s158", function (event, uiValues) {
  toggleGradeSettings();
}],
["click", "s159", function (event, uiValues) {
  saveGradeSettings();
}],
["click", "s160", function (event, uiValues) {
  addGradeTier();
}],
["click", "s161", function (event, uiValues) {
  drpOpen('grade');
}],
["click", "s162", function (event, uiValues) {
  renderGrade();
}],
["change", "s163", function (event, uiValues) {
  renderGrade();
}],
["change", "s164", function (event, uiValues) {
  renderGrade();
}],
["input", "s165", function (event, uiValues) {
  renderGrade();
}],
["click", "s166", function (event, uiValues) {
  downloadGradeListExcel();
}],
["click", "s167", function (event, uiValues) {
  if (event.target === this) closeModal('modal-erp-upload');
}],
["click", "s168", function (event, uiValues) {
  erpRunUnifiedRefresh();
}],
["click", "s169", function (event, uiValues) {
  document.getElementById('erp-order-file-input').click();
}],
["change", "s170", function (event, uiValues) {
  erpHandleFile(this, 'order');
}],
["click", "s171", function (event, uiValues) {
  document.getElementById('erp-ship-file-input').click();
}],
["change", "s172", function (event, uiValues) {
  erpHandleFile(this, 'ship');
}],
["click", "s173", function (event, uiValues) {
  closeModal('modal-erp-upload');
}],
["click", "s174", function (event, uiValues) {
  (async () => {
    const b = document.getElementById('fb-migrate-btn');
    b.disabled = true;
    b.textContent = '업로드 중...';
    const ok = await pushAllToFirebase();
    b.disabled = false;
    b.textContent = '데이터 Firebase 업로드';
    alert(ok ? '업로드 완료! 다른 브라우저에서 새로고침하면 데이터가 나타납니다.' : '업로드 실패. 콘솔을 확인해주세요.');
  })();
}],
["click", "s175", function (event, uiValues) {
  erpConfirmUpload();
}],
["click", "s176", function (event, uiValues) {
  if (event.target === this) closeGlobalSearch();
}],
["input", "s177", function (event, uiValues) {
  gsRender(this.value);
}],
["keydown", "s178", function (event, uiValues) {
  gsKeydown(event);
}],
["click", "s179", function (event, uiValues) {
  if (event.target === this) closeModal('modal-c360');
}],
["click", "s180", function (event, uiValues) {
  closeModal('modal-c360');
}],
["click", "s181", function (event, uiValues) {
  if (event.target === this) closeModal('modal-login-logs');
}],
["click", "s182", function (event, uiValues) {
  closeModal('modal-login-logs');
}],
["click", "s183", function (event, uiValues) {
  if (event.target === this) closeModal('modal-add-user');
}],
["click", "s184", function (event, uiValues) {
  closeModal('modal-add-user');
}],
["click", "s185", function (event, uiValues) {
  addUser();
}],
["click", "s186", function (event, uiValues) {
  if (event.target === this) closeModal('modal-edit-entry');
}],
["click", "s187", function (event, uiValues) {
  closeModal('modal-edit-entry');
}],
["click", "s188", function (event, uiValues) {
  saveEditEntry();
}],
["click", "s189", function (event, uiValues) {
  if (event.target === this) closeModal('modal-change-pw');
}],
["click", "s190", function (event, uiValues) {
  closeModal('modal-change-pw');
}],
["click", "s191", function (event, uiValues) {
  changeMyPassword();
}],
["click", "s192", function (event, uiValues) {
  if (event.target === this) closeModal('modal-reset-pw');
}],
["click", "s193", function (event, uiValues) {
  closeModal('modal-reset-pw');
}],
["click", "s194", function (event, uiValues) {
  resetUserPassword();
}],
["click", "s195", function (event, uiValues) {
  if (event.target === this) closeModal('modal-client-form');
}],
["change", "s196", function (event, uiValues) {
  var i = document.getElementById('cf-side');
  if (this.value === '__other__') {
    i.style.display = '';
    i.focus();
    i.value = '';
  } else {
    i.style.display = 'none';
    i.value = this.value;
  }
}],
["click", "s197", function (event, uiValues) {
  closeModal('modal-client-form');
}],
["click", "s198", function (event, uiValues) {
  saveClient();
}],
["click", "s199", function (event, uiValues) {
  if (event.target === this) closeModal('modal-client-upload');
}],
["click", "s200", function (event, uiValues) {
  downloadClientSample();
}],
["click", "s201", function (event, uiValues) {
  document.getElementById('upload-file-input').click();
}],
["dragover", "s202", function (event, uiValues) {
  event.preventDefault();
  this.classList.add('drag-over');
}],
["dragleave", "s203", function (event, uiValues) {
  this.classList.remove('drag-over');
}],
["drop", "s204", function (event, uiValues) {
  handleFileDrop(event);
}],
["change", "s205", function (event, uiValues) {
  handleFileSelect(this);
}],
["click", "s206", function (event, uiValues) {
  closeModal('modal-client-upload');
}],
["click", "s207", function (event, uiValues) {
  confirmClientUpload();
}],
["click", "s208", function (event, uiValues) {
  if (event.target === this) closeModal('modal-client-detail');
}],
["click", "s209", function (event, uiValues) {
  editClientFromDetail();
}],
["click", "s210", function (event, uiValues) {
  deleteClientFromDetail();
}],
["click", "s211", function (event, uiValues) {
  switchClientTab('info', this);
}],
["click", "s212", function (event, uiValues) {
  switchClientTab('erp', this);
}],
["click", "s213", function (event, uiValues) {
  switchClientTab('visits', this);
}],
["click", "s214", function (event, uiValues) {
  closeModal('modal-client-detail');
}],
["click", "s215", function (event, uiValues) {
  if (event.target === this) closeModal('modal-detail');
}],
["click", "s216", function (event, uiValues) {
  closeModal('modal-detail');
}],
["click", "s217", function (event, uiValues) {
  if (event.target === this) closeModal('modal-add-notice');
}],
["click", "s218", function (event, uiValues) {
  closeModal('modal-add-notice');
}],
["click", "s219", function (event, uiValues) {
  saveNotice();
}],
["click", "s220", function (event, uiValues) {
  downloadDailyEntriesExcel();
}]
]);

document.getElementById('erp-sidebar-refresh-btn')?.addEventListener('click', erpRequestSyncFromSidebar);
