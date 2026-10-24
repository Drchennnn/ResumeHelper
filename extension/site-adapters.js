/* Local, declarative DOM layouts. No downloaded script or server expression is executed. */
(function installSiteAdapters() {
  "use strict";
  if (globalThis.__personalResumeSiteAdapters) return;
  // Structural compatibility facts observed in the public platform configuration.
  // A layout is used only when its field container and one unambiguous section title exist.
  const layouts = [
    {id:"feishu",container:".ud-formily-item",label:"[data-form-field-i18n-name],label",group:"[class*='apply-form-array-card__'],.resumeEditForm-item",title:".applyFormModuleWrapper-text,.createFormSection-text"},
    {id:"mokahr",container:"[class^='apply-block-'] [class^='title-']",label:"[class^='title-']",group:"[class^='apply-fields']",title:"[class^='blockTitle'] span[class^='text-']"},
    {id:"atsx",container:".atsx-form-item",label:".atsx-form-item-label",group:".resumeEditForm-item",title:".createFormSection-title"},
    {id:"beisen",container:"[class*='form-item__']",label:"[class^='form-item__text']",group:".ux-standard-form,.form_container",title:"[id*='Recruitment']:not(:has(*))"},
    {id:"beisen_old",host:"zhiye.com",container:".form_part_container li",label:"label",group:"form",title:".dl_menutit"},
    {id:"beisen_mobile",host:"m.zhiye.com",container:".cmpt_ipt_wrap,.cmpt_calendar_wrap,.cmpt_textarea_wrap,.cmpt_poppicker_wrap",label:".form_tltle_ct",group:".u-apply-part-list > .part-list",title:".u-apply-part-list > p"},
    {id:"hotjob",container:".ant-form-item,.resume_info_item",label:".ant-form-item-label,.resume_info_title",group:".form-cell-inner,.set_i_content_table",title:".tit,.setTitle"},
    {id:"hotjob_mc",host:"wecruit.hotjob.cn",container:".resume-info .my-list-item",label:".header-title",group:".resume-info .am-list-body",title:".resume-info-title"},
    {id:"hcm",container:".ng-scope",label:".label.ng-binding.ng-scope.ng-isolate-scope",title:".hc-dialog-title.ng-binding"},
  ];
  const sectionPattern = /教育|学历|学习经历|工作|实习|项目|校园|社团|社会实践|证书|语言|技能|获奖|家庭|个人信息|求职意向/;
  const text = node => String(node?.textContent || "").replace(/\s+/g," ").replace(/[：:*]$/g,"").trim();
  function describe(element) {
    for (const layout of layouts) {
      const host = String(globalThis.location?.hostname || "");
      if (layout.host && host !== layout.host && !host.endsWith(`.${layout.host}`)) continue;
      let container = element?.closest?.(layout.container);
      let labelNode = container?.matches?.(layout.label) ? container : container?.querySelector?.(layout.label);
      if (!labelNode || labelNode.contains?.(element)) {
        container = element?.parentElement; labelNode = null;
        for (let depth = 0; container && depth < 3; depth++, container = container.parentElement) {
          const labels = Array.from(container.querySelectorAll?.(layout.label) || []).filter(node=>!node.contains(element));
          if (labels.length === 1) { labelNode = labels[0]; break; }
          if (labels.length > 1 || container.matches?.(layout.group || 'html')) break;
        }
      }
      if (!container || !labelNode) continue;
      const label = String(element.getAttribute?.("data-form-field-i18n-name") || text(labelNode));
      if (!label || label.length > 160) continue;
      let sectionRoot = container, section = "";
      for (let depth = 0; sectionRoot && depth < 8; depth++, sectionRoot = sectionRoot.parentElement) {
        const titles = Array.from(sectionRoot.querySelectorAll?.(layout.title) || []).filter(node=>sectionPattern.test(text(node)));
        if (titles.length === 1 && text(titles[0]).length <= 60) { section = text(titles[0]); break; }
        if (titles.length > 1) break;
      }
      if (!section) continue;
      const record = layout.group ? element.closest?.(layout.group) : null;
      const records = record && sectionRoot.contains(record)
        ? Array.from(sectionRoot.querySelectorAll(layout.group)).filter(node=>node.parentElement === record.parentElement)
        : [];
      return {platform:layout.id,label,container,section,sectionRoot,record:records.includes(record)?record:null,records};
    }
    return null;
  }
  globalThis.__personalResumeSiteAdapters = {describe};
})();
