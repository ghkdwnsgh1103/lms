const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $('#app');
const modal = $('#event-modal'), eventForm = $('#event-form'), modalError = $('#modal-error');
const STORAGE_KEY = 'campus-planner-events-v1';
const state = { events: [], month: new Date(), weekAnchor: new Date(), view: 'month', subject: 'all', type: 'all', search: '', nav: 'dashboard' };
state.month = new Date(); state.month.setDate(1);
const fmt = (date, options) => new Intl.DateTimeFormat('ko-KR', options).format(date);
const localISO = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const fromISO = value => { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); };
function dayDelta(value) { const today = new Date(); today.setHours(0,0,0,0); const target = fromISO(value); target.setHours(0,0,0,0); return Math.round((target-today)/86400000); }
function dday(value) { const n=dayDelta(value); return n===0?'D-Day':n>0?`D-${n}`:`D+${Math.abs(n)}`; }
function dateShort(value) { const date=fromISO(value); return `${date.getMonth()+1}.${String(date.getDate()).padStart(2,'0')} (${['일','월','화','수','목','금','토'][date.getDay()]})`; }
function toast(message, error=false) { const el=$('#toast'); el.textContent=message; el.classList.toggle('error',error); el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2500); }
function saveEvents() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events)); }
function refreshEvents() {
  try { const saved=JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); state.events=Array.isArray(saved)?saved:[]; }
  catch { state.events=[]; }
  render();
}
function loadApp() { app.hidden=false; refreshEvents(); }

function filteredEvents({includeCompleted=true}={}) {
  let items=[...state.events];
  if(!includeCompleted)items=items.filter(item=>!item.completed);
  if(state.subject!=='all')items=items.filter(item=>item.subject===state.subject);
  if(state.type!=='all')items=items.filter(item=>item.type===state.type);
  if(state.nav==='urgent')items=items.filter(item=>!item.completed&&item.type!=='강의'&&dayDelta(item.date)<=3);
  if(state.nav==='archive')items=items.filter(item=>item.completed);
  if(state.search){const query=state.search.toLowerCase();items=items.filter(item=>`${item.subject} ${item.title} ${item.type}`.toLowerCase().includes(query));}
  return items.sort((a,b)=>a.date.localeCompare(b.date)||({높음:0,보통:1,낮음:2}[a.priority]-({높음:0,보통:1,낮음:2}[b.priority])));
}
function render() { updateFilters(); renderCalendar(); renderDeadlines(); }
function updateFilters() {
  const filter=$('#subject-filter'), previous=state.subject;
  filter.innerHTML='<option value="all">전체 과목</option>';
  [...new Set(state.events.map(event=>event.subject))].forEach(subject=>{const option=document.createElement('option');option.value=subject;option.textContent=subject;filter.append(option);});
  filter.value=[...filter.options].some(option=>option.value===previous)?previous:'all'; state.subject=filter.value;
}
function typeClass(type){return type==='과제'?'assignment':type==='시험'?'exam':'lecture';}
function visibleCalendarEvents(date) {
  let items=filteredEvents().filter(item=>item.date===localISO(date));
  return items;
}
function renderCalendar() {
  const calendar=$('#calendar'); calendar.className='calendar-grid'; calendar.innerHTML='';
  const anchor=state.view==='week'?state.weekAnchor:state.month;
  const year=anchor.getFullYear(), month=anchor.getMonth();
  $('#month-title').textContent=`${year}년 ${month+1}월`;
  const lastDay=new Date(year,month+1,0).getDate();
  $('#range-meta').textContent=`${year}.${String(month+1).padStart(2,'0')}.01 — ${String(lastDay).padStart(2,'0')}`;
  const labels=['일','월','화','수','목','금','토'];
  if(state.view==='month'||state.view==='week'){
    calendar.classList.toggle('week-view',state.view==='week');
    labels.forEach(day=>{const el=document.createElement('div');el.className='weekday';el.textContent=day;calendar.append(el);});
    let start, count;
    if(state.view==='week'){start=new Date(state.weekAnchor);start.setDate(start.getDate()-start.getDay());count=7;}
    else {start=new Date(year,month,1);start.setDate(1-start.getDay());count=Math.ceil((new Date(year,month+1,0).getDate()+new Date(year,month,1).getDay())/7)*7;}
    for(let i=0;i<count;i++){
      const date=new Date(start);date.setDate(start.getDate()+i);const iso=localISO(date), events=visibleCalendarEvents(date);
      const cell=document.createElement('div');cell.className='day-cell';if(date.getMonth()!==month&&state.view==='month')cell.classList.add('other-month');if(date.getDay()===0)cell.classList.add('sunday');if(date.getDay()===6)cell.classList.add('saturday');if(iso===localISO(new Date()))cell.classList.add('today');
      const number=document.createElement('div');number.className='day-number';number.textContent=date.getDate();cell.append(number);
      events.slice(0,2).forEach(item=>{const tag=document.createElement('button');tag.className=`event-pill ${typeClass(item.type)}${item.completed?' completed':''}`;tag.textContent=item.title;tag.title=`${item.subject} · ${item.title}`;tag.addEventListener('click',event=>{event.stopPropagation();openEvent(item);});cell.append(tag);});
      if(events.length>2){const more=document.createElement('div');more.className='more-events';more.textContent=`+${events.length-2}개`;cell.append(more);}
      cell.addEventListener('click',()=>{if(events.length){const first=events[0];openEvent(first);}else{openModal(null,iso);}});calendar.append(cell);
    }
  } else {
    calendar.classList.add('calendar-list-view');
    const items=filteredEvents().filter(item=>item.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
    if(!items.length){const empty=document.createElement('div');empty.className='empty-calendar';empty.textContent=state.events.length?'조건에 맞는 일정이 없습니다.':'아직 등록된 일정이 없습니다. 첫 일정을 추가해 보세요.';calendar.append(empty);}
    const groups=new Map();for(const item of items){if(!groups.has(item.date))groups.set(item.date,[]);groups.get(item.date).push(item);}
    for(const [date,list] of groups){const row=document.createElement('div');row.className='list-day';const day=document.createElement('div');day.className='list-day-date';day.textContent=dateShort(date);const events=document.createElement('div');events.className='list-day-events';for(const item of list){const line=document.createElement('div');line.className='list-event';const badge=document.createElement('span');badge.className=`event-pill ${typeClass(item.type)}${item.completed?' completed':''}`;badge.textContent=item.type;const title=document.createElement('button');title.className='text-button';title.textContent=`${item.subject} · ${item.title}`;title.addEventListener('click',()=>openEvent(item));line.append(badge,title);if(item.type!=='강의'){const dd=document.createElement('span');dd.className='dday';dd.textContent=dday(item.date);line.append(dd);}events.append(line);}row.append(day,events);calendar.append(row);}
  }
}

function renderDeadlines(){
  const list=$('#deadline-list');list.innerHTML='';
  let items=state.events.filter(item=>item.type!=='강의').sort((a,b)=>dayDelta(a.date)-dayDelta(b.date)||({높음:0,보통:1,낮음:2}[a.priority]-({높음:0,보통:1,낮음:2}[b.priority]))).slice(0,4);
  $('#deadline-count').textContent=`총 ${state.events.filter(item=>!item.completed&&item.type!=='강의').length}개 남음`;
  if(!items.length){const empty=document.createElement('div');empty.className='empty-calendar';empty.textContent='아직 등록된 마감 일정이 없어요.';list.append(empty);}
  for(const item of items){const row=document.createElement('div');row.className=`deadline-item${item.completed?' is-complete':''}`;const check=document.createElement('input');check.type='checkbox';check.className='deadline-check';check.checked=item.completed;check.setAttribute('aria-label',`${item.title} 완료 처리`);check.addEventListener('change',()=>{item.completed=check.checked;saveEvents();render();toast(check.checked?'일정을 완료했어요.':'완료 상태를 해제했어요.');});const copy=document.createElement('div');copy.className='deadline-copy';const title=document.createElement('b');title.textContent=item.title;const sub=document.createElement('small');sub.textContent=`${item.subject} · ${dateShort(item.date)}${item.priority==='높음'?' · 중요':''}`;copy.append(title,sub);const badge=document.createElement('span');const delta=dayDelta(item.date);badge.className=`dday${delta>0&&delta<=5?' amber':''}${delta>5?' future':''}${item.completed?' done':''}`;badge.textContent=item.completed?'완료':dday(item.date);row.append(check,copy,badge);row.addEventListener('dblclick',()=>openEvent(item));list.append(row);}
}

function openModal(item=null, date=localISO(new Date())){
  eventForm.reset();modalError.hidden=true;$('#event-id').value=item?.id||'';$('#modal-title').textContent=item?'일정 수정':'새 일정 추가';$('#save-event').textContent=item?'변경사항 저장':'일정 저장';$('#delete-event').hidden=!item;
  $('#event-subject').value=item?.subject||'';$('#event-title').value=item?.title||'';$('#event-type').value=item?.type||'과제';$('#event-date').value=item?.date||date;$('#event-priority').value=item?.priority||'보통';modal.hidden=false;setTimeout(()=>$('#event-subject').focus(),20);
}
function closeModal(){modal.hidden=true;}
function openEvent(item){openModal(item);}
$$('.close-modal,.cancel-modal').forEach(button=>button.addEventListener('click',closeModal));modal.addEventListener('click',event=>{if(event.target===modal)closeModal();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)closeModal();});
eventForm.addEventListener('submit',async event=>{
  event.preventDefault();modalError.hidden=true;
  const payload={subject:$('#event-subject').value.trim(),title:$('#event-title').value.trim(),type:$('#event-type').value,date:$('#event-date').value,priority:$('#event-priority').value};
  if(!payload.subject){modalError.textContent='과목명을 입력해 주세요.';modalError.hidden=false;return;}
  if(payload.subject.length>30){modalError.textContent='과목명은 30자 이하로 입력해 주세요.';modalError.hidden=false;return;}
  if(!payload.title){modalError.textContent='일정 제목을 입력해 주세요.';modalError.hidden=false;return;}
  if(payload.title.length>60){modalError.textContent='일정 제목은 60자 이하로 입력해 주세요.';modalError.hidden=false;return;}
  if(!payload.date){modalError.textContent='올바른 날짜를 선택해 주세요.';modalError.hidden=false;return;}
  const id=$('#event-id').value, button=$('#save-event');button.disabled=true;
  if(id){const existing=state.events.find(item=>item.id===id);if(existing)Object.assign(existing,payload);}
  else state.events.push({id:crypto.randomUUID(),...payload,completed:false,createdAt:new Date().toISOString()});
  saveEvents();closeModal();render();toast(id?'일정이 수정되었습니다.':'새 일정을 저장했습니다.');button.disabled=false;
});
$('#delete-event').addEventListener('click',()=>{const id=$('#event-id').value;if(!id)return;const title=$('#event-title').value;if(!window.confirm(`“${title}” 일정을 삭제하시겠습니까?`))return;state.events=state.events.filter(item=>item.id!==id);saveEvents();closeModal();render();toast('일정을 삭제했습니다.');});

function addEventButton(button){button.addEventListener('click',()=>openModal());}
addEventButton($('#add-event-top'));addEventButton($('#add-event-main'));
$('#prev-month').addEventListener('click',()=>{if(state.view==='week'){state.weekAnchor.setDate(state.weekAnchor.getDate()-7);}else state.month.setMonth(state.month.getMonth()-1);renderCalendar();});
$('#next-month').addEventListener('click',()=>{if(state.view==='week'){state.weekAnchor.setDate(state.weekAnchor.getDate()+7);}else state.month.setMonth(state.month.getMonth()+1);renderCalendar();});
$('#today-button').addEventListener('click',()=>{state.month=new Date();state.month.setDate(1);state.weekAnchor=new Date();renderCalendar();});
$$('.segment').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;$$('.segment').forEach(item=>item.classList.toggle('active',item===button));renderCalendar();}));
$('#subject-filter').addEventListener('change',event=>{state.subject=event.target.value;renderCalendar();});
$('#type-filter').addEventListener('change',event=>{state.type=event.target.value;renderCalendar();});
$('#reset-filters').addEventListener('click',()=>{state.subject='all';state.type='all';state.search='';state.nav='dashboard';$('#subject-filter').value='all';$('#type-filter').value='all';$('#search').value='';$$('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.nav==='dashboard'));render();});
$('#search').addEventListener('input',event=>{state.search=event.target.value.trim();renderCalendar();renderDeadlines();});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#search').focus();}});
$$('.nav-item[data-nav]').forEach(button=>button.addEventListener('click',()=>{state.nav=button.dataset.nav;$$('.nav-item').forEach(item=>item.classList.toggle('active',item===button));$('#left-nav').classList.remove('open');if(state.nav==='urgent'){state.type='all';$('#type-filter').value='all';}render();if(state.nav==='urgent')toast('마감이 3일 이내인 과제와 시험을 표시합니다.');if(state.nav==='archive')toast('완료된 일정 보관함');}));
$('#mobile-menu').addEventListener('click',()=>$('#left-nav').classList.toggle('open'));
$('#quick-form').addEventListener('submit',event=>{event.preventDefault();const title=$('#quick-input').value.trim();if(!title)return;const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);state.events.push({id:crypto.randomUUID(),subject:'기타',title,type:'과제',date:localISO(tomorrow),priority:'보통',completed:false,createdAt:new Date().toISOString()});saveEvents();$('#quick-input').value='';render();toast('빠른 할 일을 추가했습니다.');});
$('#view-all-deadlines').addEventListener('click',()=>{$('.nav-item[data-nav="urgent"]').click();});
$('#timetable-button').addEventListener('click',()=>{$('.segment[data-view="week"]').click();$('#calendar').scrollIntoView({behavior:'smooth',block:'center'});});
$('#sync-button').addEventListener('click',()=>toast('LMS 자동 연동은 MVP 범위에 포함되지 않습니다.'));

loadApp();
