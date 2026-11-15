/* Date-only calendar projection. No task mutation and no new scheduling rules. */
(function(root){
 'use strict';
 const parse=date=>new Date(String(date)+'T12:00:00Z');
 const valid=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(+parse(date))&&parse(date).toISOString().slice(0,10)===date;
 const add=(date,days)=>{const value=parse(date);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
 const distance=(a,b)=>Math.round((parse(b)-parse(a))/86400000);
 const monday=date=>add(date,-((parse(date).getUTCDay()+6)%7));
 function month(date,delta){const value=parse(date);value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+delta);return value.toISOString().slice(0,10);}
 function period(mode,date){
  if(mode==='week'){const start=monday(date);return {start,end:add(start,6)};}
  const first=date.slice(0,8)+'01',last=add(month(first,1),-1);
  return {start:monday(first),end:add(monday(last),6)};
 }
 function taskRange(task){if(!valid(task.start))return null;return {start:task.start,end:valid(task.end)&&task.end>=task.start?task.end:task.start};}
 function intersects(task,start,end){const range=taskRange(task);return !!range&&range.start<=end&&range.end>=start;}
 function overdue(task,today){return task.status!=='Erledigt'&&valid(task.planned_end)&&task.planned_end<today;}
 function running(task){return task.status!=='Erledigt'&&(task.status==='In Arbeit'||!!task.actual_start&&!task.actual_end);}
 function quickMatch(task,filter,today){
  if(filter==='overdue')return overdue(task,today);
  if(filter==='week'){const week=period('week',today);return intersects(task,week.start,week.end)||running(task);}
  if(filter==='open-end')return task.status!=='Erledigt'&&!valid(task.planned_end);
  if(filter==='running')return running(task);
  return true;
 }
 function segments(items,start,end){
  const ends=[];
  return items.filter(item=>valid(item.start)&&valid(item.end)&&item.start<=end&&item.end>=start)
   .map(item=>({item,start:item.start<start?start:item.start,end:item.end>end?end:item.end}))
   .sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end)||Number(a.item.id)-Number(b.item.id))
   .map(segment=>{let lane=ends.findIndex(last=>last<segment.start);if(lane<0)lane=ends.length;ends[lane]=segment.end;
    return {...segment,lane,column:distance(start,segment.start),span:distance(segment.start,segment.end)+1,continuesBefore:segment.item.start<start,continuesAfter:segment.item.end>end};});
 }
 const api={valid,add,distance,monday,month,period,taskRange,intersects,overdue,running,quickMatch,segments};
 root.PHBScheduleCalendar=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
