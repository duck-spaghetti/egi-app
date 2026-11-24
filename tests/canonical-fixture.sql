-- Synthetic approved/draft/private reads for A3's independent native harness.
CREATE ROLE egi_app_test_reader LOGIN IN ROLE egi_reader;
ALTER ROLE egi_app_test_reader SET default_transaction_read_only=on;
DO $$ DECLARE territory uuid; v uuid; axis uuid; term uuid; tr uuid; release uuid; adoption uuid; rev uuid;
 primary_id uuid; primary_rev uuid; secondary uuid; secondary_rev uuid; BEGIN
 rev:=pg_temp.save('territory','{"code":"roma","name":"Roma test","country_code":"IT","timezone_name":"Europe/Rome","original_language":"it"}');
 SELECT entity_id INTO territory FROM governance.entity_revisions WHERE revision_id=rev;
 PERFORM pg_temp.publish(rev);

 rev:=pg_temp.save('taxonomy_vocabulary','{"code":"test-needs","name":"Needs","original_language":"it"}');
 SELECT entity_id INTO v FROM governance.entity_revisions WHERE revision_id=rev;
 PERFORM pg_temp.publish(rev);
 axis:=governance.create_taxonomy_axis(v,'need');
 tr:=pg_temp.save('taxonomy_term',jsonb_build_object('vocabulary_id',v,'axis_id',axis,'code','istruzione',
  'name','Istruzione','original_language','it','presentation_metadata',jsonb_build_object('code','istruzione','icon','building','color','#466b70')));
 SELECT entity_id INTO term FROM governance.entity_revisions WHERE revision_id=tr;
 PERFORM pg_temp.publish(tr);
 release:=governance.freeze_taxonomy_release(rev,'test',jsonb_build_array(jsonb_build_object('axis_id',axis,'label','Need')),
  jsonb_build_array(jsonb_build_object('term_id',term,'revision_id',tr)),'[]','test');
 adoption:=governance.adopt_taxonomy_release(territory,release,current_date,NULL,'test');
 rev:=pg_temp.save('service',jsonb_build_object('name','Public service','description','Approved description','delivery_mode','telephone',
  'contacts',jsonb_build_array(jsonb_build_object('channel_type','phone','value','061111111'),
                             jsonb_build_object('channel_type','phone','value','PRIVATE999','is_public',false)),
  'territories',jsonb_build_array(territory),
  'classifications',jsonb_build_array(jsonb_build_object('adoption_id',adoption,'term_id',term))));
 PERFORM pg_temp.publish(rev);
 primary_rev:=rev;
 SELECT entity_id INTO primary_id FROM governance.entity_revisions WHERE revision_id=rev;
 INSERT INTO sources.assertions(assertion_id,subject_id,attribute_code,normalized_value,certainty,method)
 VALUES('57000000-0000-0000-0000-000000000004','56000000-0000-0000-0000-000000000003','record','"secondary record"','stated','synthetic');
 secondary_rev:=governance.save_revision('service',NULL,NULL,NULL,
  '{"name":"Approved secondary","description":"Only selected fragments","delivery_mode":"telephone",
  "contacts":[{"channel_type":"phone","value":"062222222"},{"channel_type":"phone","value":"SECONDARY_PRIVATE","is_public":false}],
  "evidence":{"record":[{"assertion_id":"57000000-0000-0000-0000-000000000004","role":"supporting"}]} }','test');
 SELECT entity_id INTO secondary FROM governance.entity_revisions WHERE revision_id=secondary_rev;
 PERFORM governance.review_revision(secondary_rev,NULL,'approved','Exact fragment approval');
 PERFORM governance.record_sync_version('51000000-0000-0000-0000-000000000001',repeat('a',64),true,NULL,NULL,
  jsonb_build_array(jsonb_build_object('service_id',primary_id,'state','loaded','identity',jsonb_build_object('keys',jsonb_build_array('primary')),
   'comparable','{}'::jsonb,'source_body',jsonb_build_object('revisions',jsonb_build_object('service',primary_rev)))));
 PERFORM governance.record_sync_version('51000000-0000-0000-0000-000000000002',repeat('b',64),true,NULL,NULL,
  jsonb_build_array(jsonb_build_object('service_id',secondary,'state','loaded','identity',jsonb_build_object('keys',jsonb_build_array('secondary')),
   'comparable','{}'::jsonb,'source_body',jsonb_build_object('revisions',jsonb_build_object('service',secondary_rev)))));
 PERFORM governance.link_source_services('51000000-0000-0000-0000-000000000001','primary',
  '51000000-0000-0000-0000-000000000002','secondary','same','a','Synthetic explicit duplicate decision');

 PERFORM pg_temp.save('service',jsonb_build_object('name','Never approved','description','PENDING_SECRET',
  'delivery_mode','telephone','contacts',jsonb_build_array(jsonb_build_object('channel_type','phone','value','DRAFT999')),
  'territories',jsonb_build_array(territory)));
END $$;
