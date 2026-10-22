-- HH only: add seven pilot places, preserving existing invitations and authorization.
do $migration$
declare definition text;
begin
 definition := pg_get_functiondef('private.pilot_invitations(text,text,uuid)'::regprocedure);
 if position('>=7 then' in definition)=0 or position('seven invited households' in definition)=0 then
  raise exception 'Expected the existing seven-place pilot limit';
 end if;
 definition := replace(definition, '>=7 then', '>=14 then');
 definition := replace(definition, 'seven invited households', 'fourteen invited households');
 execute definition;
end;
$migration$;
