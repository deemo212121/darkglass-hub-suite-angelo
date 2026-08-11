-- =====================================================================
-- Staff List backfill — writes the 4 Excel-only fields (personal_email,
-- tier_level, work_phone, staff_note) onto EXISTING profiles rows,
-- matched by display_name. Run once in the Supabase SQL Editor, AFTER
-- migration 0162.
--
-- Matches by name only (case/whitespace-insensitive) — if two different
-- people at different branches happen to share an exact display name,
-- both get the same values here; that's a known limitation, not a bug.
-- A name with no matching profile is silently a no-op (0 rows updated),
-- not an error — run staff_list_backfill_names_check.sql afterward to
-- see exactly which of the 182 names didn't match anything,
-- so you can decide whether those people need a real account created
-- first (Master List doesn't show anyone without one).
-- =====================================================================

update profiles set personal_email = 'matt_simmons@rocketmail.com', tier_level = 'Senior Branch Manager', work_phone = '7065704836', staff_note = 'BM and SBM' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Asheville
update profiles set personal_email = 'schutsjk@gmail.com', tier_level = 'Tier 2', work_phone = '931-993-5704', staff_note = '3/26 Tier 2' where lower(trim(display_name)) = lower(trim('Jordan Koetsier')); -- Asheville
update profiles set personal_email = 'johnathanwallen@gmail.com' where lower(trim(display_name)) = lower(trim('Johnathan Wesley Allen')); -- Asheville
update profiles set tier_level = 'Senior Branch Manager', work_phone = '7065704836' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Atlanta
update profiles set personal_email = 'kevinkhaip@gmail.com', tier_level = 'Technical Manager', work_phone = '424-537-4447', staff_note = 'Previous JDS tech // promoted to Tech manager - confirmed by Daven 1/26' where lower(trim(display_name)) = lower(trim('Kevin Khaiphanliane')); -- Atlanta
update profiles set personal_email = 'abrahamshinyangim@gmail.com', tier_level = 'Tier 2', staff_note = 'Previous JDS tech. In field 12/1' where lower(trim(display_name)) = lower(trim('Abraham Im')); -- Atlanta
update profiles set personal_email = 'joshsilvab@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Joshua Silva')); -- Atlanta
update profiles set personal_email = 'berggerrell@icloud.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Gerrell Berg')); -- Atlanta
update profiles set personal_email = 'abelseverino19@gmail.com', tier_level = 'Tier 3', staff_note = 'match up last day is 6/16/2026' where lower(trim(display_name)) = lower(trim('Abel Severino')); -- Atlanta
update profiles set personal_email = 'Naporanathan10@gmail.com', tier_level = 'Tier 3', staff_note = 'Training starts 4/6/2026' where lower(trim(display_name)) = lower(trim('Nathan Napora')); -- Atlanta
update profiles set tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Erin Williams')); -- Atlanta
update profiles set personal_email = 'nguyencalvin090@gmail.com', tier_level = 'Tier 3', staff_note = 'Starting as a tech 6/16/25' where lower(trim(display_name)) = lower(trim('Calvin Nguyen')); -- Atlanta
update profiles set tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Anna Seo')); -- Atlanta
update profiles set personal_email = 'nlakhani.work@gmail.com' where lower(trim(display_name)) = lower(trim('Naveen Lakhani')); -- Atlanta
update profiles set personal_email = 'generalsmith52@icloud.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Seth Smith')); -- Atlanta
update profiles set tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('danny thornton')); -- Birmingham
update profiles set personal_email = 'David.Sims@usinhomeservices.com', tier_level = 'Branch Manager', work_phone = '2059141821' where lower(trim(display_name)) = lower(trim('David Sims')); -- Birmingham
update profiles set personal_email = 'keyoungoh@gmail.com', tier_level = 'Tier 1', work_phone = '2059229194' where lower(trim(display_name)) = lower(trim('Andy Oh')); -- Birmingham
update profiles set personal_email = 'Zontae7grant@gmail.com', tier_level = 'Tier 3', work_phone = '2059771862' where lower(trim(display_name)) = lower(trim('Zonate Grant')); -- Birmingham
update profiles set personal_email = 'davenh90@gmail.com' where lower(trim(display_name)) = lower(trim('Daven Hodge')); -- Cape Girardeau
update profiles set personal_email = 'mattnichols1117@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Matthew Nichols')); -- Cape Girardeau
update profiles set personal_email = 'harrisdep75@icloud.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Deprece Harris')); -- Cape Girardeau
update profiles set personal_email = 'olingerhome7@gmail.com' where lower(trim(display_name)) = lower(trim('Alaska Grace Olinger')); -- Cape Girardeau
update profiles set personal_email = 'tristonrmitchell@outlook.com' where lower(trim(display_name)) = lower(trim('Triston Mitchell')); -- Cape Girardeau
update profiles set personal_email = 'olingerhome7@gmail.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Alaska Olinger')); -- Cape Girardeau
update profiles set personal_email = 'christianandrews911@yahoo.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Christian Andrews')); -- Chattanooga
update profiles set personal_email = 'jblackburndsc@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Jacob Blackburn')); -- Chattanooga
update profiles set personal_email = 'usmcferg21@gmail.com', tier_level = 'Tier 3', staff_note = 'Start Training 04/13/26' where lower(trim(display_name)) = lower(trim('Austin Ferguson')); -- Chattanooga
update profiles set personal_email = 'ashleycow98@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Ashley Cowart')); -- Chattanooga
update profiles set personal_email = 'matt_simmons@rocketmail.com', tier_level = 'Senior Branch Manager', work_phone = '7065704836' where lower(trim(display_name)) = lower(trim('matt simmons')); -- Columbus
update profiles set personal_email = 'tysondejaun84@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('A''dejuan Tyson')); -- Columbus
update profiles set personal_email = 'Juviesmith@icloud.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Percy Smith Jr')); -- Columbus
update profiles set personal_email = 'adeising13@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Amanda Simmons')); -- Columbus
update profiles set personal_email = 'Jacksonfredrick142@gmail.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Fredrick Jackson')); -- Columbus
update profiles set personal_email = 'thorntondanny108@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('danny thornton')); -- Destin
update profiles set personal_email = 'gar.mccar@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Garrett McCarley')); -- Destin
update profiles set personal_email = 'lamartyreekh24@gmail.com' where lower(trim(display_name)) = lower(trim('Lamar Hudson')); -- Destin
update profiles set personal_email = 'Lashamus.dowell@usinhomeservices.com', tier_level = 'Senior Branch Manager', staff_note = 'SBM' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- Huntsville
update profiles set personal_email = 'joe.dane713@gmail.com', tier_level = 'Technical Manager', work_phone = '9319930120' where lower(trim(display_name)) = lower(trim('Jordan Stanley')); -- Huntsville
update profiles set personal_email = 'adambthumphrey@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Adam Humphrey')); -- Huntsville
update profiles set personal_email = 'kyle.arscott256@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Kyle Arscott')); -- Huntsville
update profiles set personal_email = 'kingrah2000@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Abdul-Rahman Abdullah')); -- Huntsville
update profiles set personal_email = 'zridley35@yahoo.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Zackery Ridley')); -- Huntsville
update profiles set personal_email = 'nathanbwagner2319@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Nathan Wagner')); -- Huntsville
update profiles set personal_email = 'illiana.diaz11105@icloud.com', staff_note = 'Terminated' where lower(trim(display_name)) = lower(trim('Illiana De Leon')); -- Huntsville
update profiles set tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Cashawn Ford')); -- Huntsville
update profiles set personal_email = 'davenh90@gmail.com', tier_level = 'Senior Branch Manager', work_phone = '8505306026' where lower(trim(display_name)) = lower(trim('LaShamus Dowell')); -- Jonesboro
update profiles set personal_email = 'derricksergant86@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('derrick sargent')); -- Jonesboro
update profiles set personal_email = 'farrisdepriest4@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Farris Bruce')); -- Jonesboro
update profiles set tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Isaac Booth')); -- Jonesboro
update profiles set personal_email = 'davenh90@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Jackson, MS
update profiles set personal_email = 'thortondanny108@gmail.com', tier_level = 'Branch Manager', work_phone = '901-706-0983' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Jackson, MS
update profiles set personal_email = 'acavett1738@gmail.com', tier_level = 'Tier 2', staff_note = '46129' where lower(trim(display_name)) = lower(trim('Anthony Cavett')); -- Jackson, MS
update profiles set personal_email = 'mikkelb39@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Mikkel Brown')); -- Jackson, MS
update profiles set personal_email = 'tywon2011@hotmail.com', tier_level = 'Tier 2' where lower(trim(display_name)) = lower(trim('tywon ross')); -- Jackson, MS
update profiles set personal_email = 'reginaldstewart2000@yahoo.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Reginald Stewart')); -- Jackson, MS
update profiles set personal_email = 'jeremy28nichols@gmail.com', tier_level = 'Training', staff_note = '2' where lower(trim(display_name)) = lower(trim('jeremie nichols')); -- Jackson, MS
update profiles set personal_email = 'houstonmainza@gmail.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('mainza houston')); -- Jackson, MS
update profiles set personal_email = 'nicholsderious@gmail.com', tier_level = 'Tier 1', staff_note = 'Moved to STL' where lower(trim(display_name)) = lower(trim('Derious Nichols')); -- Jackson, MS
update profiles set personal_email = 'terrydavis030@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Terry Davis')); -- Jackson, MS
update profiles set personal_email = 'davenh90@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('LaShamus Dowell')); -- Jackson, TN
update profiles set personal_email = 'bull2federal@gmail.com', tier_level = 'Branch Manager', staff_note = 'Tm 6/30 by Danny Thorton' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- Jackson, TN
update profiles set tier_level = 'Tier 3', staff_note = 'started training 7/10 also worked 7/11(sat)' where lower(trim(display_name)) = lower(trim('James Dickerson')); -- Jackson, TN
update profiles set tier_level = 'Tier 3', staff_note = 'scheduled to start training 7/18' where lower(trim(display_name)) = lower(trim('Garrison Brown')); -- Jackson, TN
update profiles set personal_email = 'Cam24forrest@yahoo.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Cameron Forrest')); -- Jackson, TN
update profiles set personal_email = 'matt_simmons@rocketmail.com', tier_level = 'Senior Branch Manager', staff_note = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Jacksonville
update profiles set personal_email = 'zakarya.moradi2015@gmail.com', tier_level = 'Tier 2', work_phone = 'N/A' where lower(trim(display_name)) = lower(trim('Zakarya Moradi')); -- Jacksonville
update profiles set personal_email = 'chefbrad3@gmail.com', tier_level = 'Tier 3', work_phone = 'N/A' where lower(trim(display_name)) = lower(trim('Bradley Hollowell')); -- Jacksonville
update profiles set personal_email = 'gamerboy1117@gmail.com' where lower(trim(display_name)) = lower(trim('Jacob Reed')); -- Jacksonville
update profiles set personal_email = 'f.qasimi2000@gmail.com', tier_level = 'Parts', work_phone = 'N/A' where lower(trim(display_name)) = lower(trim('Farahnaz Qasemi')); -- Jacksonville
update profiles set personal_email = 'Lashamus.dowell@usinhomeservices.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- Knoxville
update profiles set personal_email = 'mylesalex31@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Alex Myles')); -- Knoxville
update profiles set personal_email = 'zaccoisman@gmail.com', tier_level = 'Tier 1' where lower(trim(display_name)) = lower(trim('Zac Coisman')); -- Knoxville
update profiles set personal_email = 'jamesdech429@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('James Dech')); -- Knoxville
update profiles set personal_email = 'james.houston01@aol.com', tier_level = 'Part Manager' where lower(trim(display_name)) = lower(trim('James Houston')); -- Knoxville
update profiles set tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Joshua Rinehart')); -- Knoxville
update profiles set personal_email = 'thorntondanny108@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Little Rock
update profiles set personal_email = 'thortondanny108@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Little Rock
update profiles set personal_email = 'riddleandre40@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('andre riddle')); -- Little Rock
update profiles set personal_email = 'ndetten7@gmail.com', tier_level = 'Branch Manager', staff_note = '46138' where lower(trim(display_name)) = lower(trim('nocona detten')); -- Little Rock
update profiles set personal_email = 'sydatu@gmail.com' where lower(trim(display_name)) = lower(trim('Blake Shinn')); -- Little Rock
update profiles set personal_email = 'boyettejohn29@gmail.com' where lower(trim(display_name)) = lower(trim('john boyette')); -- Little Rock
update profiles set personal_email = 'davenh90@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Lake Charles
update profiles set personal_email = 'thortondanny108@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Danny Thornton')); -- Lake Charles
update profiles set personal_email = 'coopershaffett4@gmail.com', tier_level = 'Technical Manager', staff_note = '46127' where lower(trim(display_name)) = lower(trim('cooper shaffett')); -- Lake Charles
update profiles set tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('dylan deeb')); -- Lake Charles
update profiles set tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('christian schexnayder')); -- Lake Charles
update profiles set personal_email = 'Lashamus.dowell@usinhomeservices.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- Memphis
update profiles set personal_email = 'sean.smith81@yahoo.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Sean Anthony Smith')); -- Memphis
update profiles set personal_email = 'darrinstewart93@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Darrin Michael Stewart')); -- Memphis
update profiles set personal_email = 'darryel23@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Darryel Burdette')); -- Memphis
update profiles set personal_email = 'jefflucas252@yahoo.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Jeffrey Allen Lucas, Jr.')); -- Memphis
update profiles set personal_email = 'Ricoshaw55@gmail.com', tier_level = 'Tier 2' where lower(trim(display_name)) = lower(trim('Rico Ali Jah Juan Shaw')); -- Memphis
update profiles set personal_email = 'mattnichols1117@gmail.com', tier_level = 'Tier 1' where lower(trim(display_name)) = lower(trim('Matthew Nichols')); -- Memphis
update profiles set personal_email = 'annanodongo27@gmail.com', tier_level = 'Parts', staff_note = 'parts' where lower(trim(display_name)) = lower(trim('Annan Odongo')); -- Memphis
update profiles set personal_email = 'arnulfo.montesclaros@usinhomeservices.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Arnulfo Jr Pongos Montesclaros')); -- Memphis
update profiles set personal_email = 'kiyongsama0123@gmail.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Christian Reynes')); -- Memphis
update profiles set personal_email = 'DenverM@usinhomeservices.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Denver Memije')); -- Memphis
update profiles set personal_email = 'ian.m@usinhomeservices.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Ian Isidro Montesclaros')); -- Memphis
update profiles set personal_email = 'kenubay07@gmail.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Ken Ubay')); -- Memphis
update profiles set personal_email = 'mariefrances@usinhomeservices.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Marie Frances Javier')); -- Memphis
update profiles set personal_email = 'mharlet.linchangco@usinhomeservices.com', tier_level = 'Claims' where lower(trim(display_name)) = lower(trim('Mharlet Linchangco')); -- Memphis
update profiles set personal_email = 'bascoloumariekate@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Lou Marie Kate Basco')); -- Memphis
update profiles set personal_email = 'jhennelynmanato@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Jhennelyn Mae Anne Nato')); -- Memphis
update profiles set personal_email = 'herediarobmae.rmh@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Robyn Mae Heredia')); -- Memphis
update profiles set personal_email = 'shanemariegrebadomia@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Shane Marie Rebadomoa')); -- Memphis
update profiles set personal_email = 'daniemarie.mercado@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Daniela Mercado')); -- Memphis
update profiles set personal_email = 'airizteo1991@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Airiz Teo Diamona')); -- Memphis
update profiles set personal_email = 'Ajdandann07@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Angelica Dandan')); -- Memphis
update profiles set personal_email = 'murray.lorico10@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Anne Murray Lorico')); -- Memphis
update profiles set personal_email = 'cath.stamaria12@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Cathrina Sta.Maria')); -- Memphis
update profiles set personal_email = 'joannlazarte92@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Jo-Ann Lazarte')); -- Memphis
update profiles set personal_email = 'loubayani@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Louie Bayani')); -- Memphis
update profiles set personal_email = 'maczarina16@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Ma. Czarina Lagumen')); -- Memphis
update profiles set personal_email = 'maribethgazmen9@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Maribeth Gazmen Unciano')); -- Memphis
update profiles set personal_email = 'marygracecosio25@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Mary Grace Cosio')); -- Memphis
update profiles set personal_email = 'patrick.tendero00@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Patrick Mitchell Tendero')); -- Memphis
update profiles set personal_email = 'annortiz9192@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Rochelle Ann Ortiz')); -- Memphis
update profiles set personal_email = 'carusca.wincel@gmail.com', tier_level = 'CSR' where lower(trim(display_name)) = lower(trim('Wincel Franz Carusca')); -- Memphis
update profiles set personal_email = 'landonccogbill2801@gmail.com', tier_level = 'Training', staff_note = '04/22 -not on ER yet' where lower(trim(display_name)) = lower(trim('landon cogill')); -- Memphis
update profiles set personal_email = 'thorntondanny108@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('danny thornton')); -- Mobile
update profiles set personal_email = 'Dom2fast2furious@gmail.com', tier_level = 'Tier 2' where lower(trim(display_name)) = lower(trim('Dominic Holman')); -- Mobile
update profiles set personal_email = 'rmadison1340@gmail.com' where lower(trim(display_name)) = lower(trim('Ryan Madison')); -- Mobile
update profiles set personal_email = 'Lauren.Leshay@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Lauren Andrews')); -- Mobile
update profiles set personal_email = 'jacobreed03@icloud.com' where lower(trim(display_name)) = lower(trim('Jacob Samuel Reed')); -- Mobile
update profiles set personal_email = 'matt_simmons@rocketmail.com', tier_level = 'Senior Branch Manager', work_phone = '7065704836' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Montgomery
update profiles set personal_email = 'marsh.leon98@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Leon Marsh')); -- Montgomery
update profiles set personal_email = 'j.godfrey0118@gmail.com', tier_level = 'Tier 2' where lower(trim(display_name)) = lower(trim('John Godfrey')); -- Nashville
update profiles set personal_email = 'justin.robert0712@gmail.com', tier_level = 'Tier 2' where lower(trim(display_name)) = lower(trim('Justin Robertson')); -- Nashville
update profiles set personal_email = 'julesc0130@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('Juliannah Caviness-Ferguson')); -- Nashville
update profiles set personal_email = 'leosun40@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Leo Sun')); -- Nashville
update profiles set personal_email = 'Lashamus.dowell@usinhomeservices.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- New Orleans
update profiles set personal_email = 'jwease05@icloud.com', tier_level = 'Tier 2', staff_note = '46049' where lower(trim(display_name)) = lower(trim('Joseph Wease')); -- New Orleans
update profiles set personal_email = 'cmush133@icloud.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('cole mushinsky')); -- New Orleans
update profiles set personal_email = 'xcubx@yahoo.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Charles Fontenot')); -- New Orleans
update profiles set personal_email = 'kalebfrench504@gmail.com' where lower(trim(display_name)) = lower(trim('caleb french')); -- New Orleans
update profiles set personal_email = 'losray2@gmail.com', tier_level = 'Parts' where lower(trim(display_name)) = lower(trim('shannon thomas')); -- New Orleans
update profiles set personal_email = 'rltourere@gmail.com', tier_level = 'Tier 3', staff_note = 'terminated 8/10' where lower(trim(display_name)) = lower(trim('ryder tourere')); -- New Orleans
update profiles set personal_email = 'matt_simmons@rocketmail.com', work_phone = '7065704836' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Norfolk
update profiles set personal_email = 'chrissimpson00@Hotmail.com', tier_level = 'Branch Manager', work_phone = '---', staff_note = '8-9 Tickets Max' where lower(trim(display_name)) = lower(trim('Chris Simpson')); -- Norfolk
update profiles set personal_email = 'Aiden.lindsey02@gmail.com', tier_level = 'Tier 3', staff_note = '5-6 Ticket Max' where lower(trim(display_name)) = lower(trim('Edward (Aiden) Lindsey')); -- Norfolk
update profiles set personal_email = 'Bsjanel1212@gmail.com' where lower(trim(display_name)) = lower(trim('Brandi Janell Smith')); -- Norfolk
update profiles set personal_email = 'matt_simmons@rocketmail.com', work_phone = '7065704836' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Richmond
update profiles set personal_email = 'chrissimpson00@Hotmail.com', tier_level = 'Branch Manager', work_phone = '---', staff_note = '9-10 Tickets Max' where lower(trim(display_name)) = lower(trim('Chris Simpson')); -- Richmond
update profiles set personal_email = 'Obeykolby433@gmail.com', work_phone = '(804) 948-6079' where lower(trim(display_name)) = lower(trim('Kolby fleck')); -- Richmond
update profiles set personal_email = 'matt_simmons@rocketmail.com' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Raleigh
update profiles set personal_email = 'trackstar9691@gmail.com', tier_level = 'Technical Manager', work_phone = '-', staff_note = 'promoted to Tech manager - confirmed by Daven 01/26' where lower(trim(display_name)) = lower(trim('Alexxis Henry')); -- Raleigh
update profiles set personal_email = 'Marcjames1423@yahoo.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Marc James')); -- Raleigh
update profiles set personal_email = 'joahwelder@gmail.com', tier_level = 'Training', staff_note = 'Start alone 6/1' where lower(trim(display_name)) = lower(trim('Joshua Williamson')); -- Raleigh
update profiles set personal_email = 'Jcamel0224@gmail.com', tier_level = 'Tier 3', staff_note = 'Start Alone 5/11' where lower(trim(display_name)) = lower(trim('Javier Camel')); -- Raleigh
update profiles set personal_email = 'masoncor97@gmail.com', tier_level = 'Training' where lower(trim(display_name)) = lower(trim('Mason Redker')); -- Raleigh
update profiles set personal_email = 'davenh90@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('danny thornton')); -- San Antonio
update profiles set personal_email = 'erickgzn@gmail.com', tier_level = 'Branch Manager', staff_note = 'free rent, tier 2' where lower(trim(display_name)) = lower(trim('Erick Guzman')); -- San Antonio
update profiles set personal_email = 'matt_simmons@rocketmail.com', tier_level = 'Senior Branch Manager', work_phone = '7065704836', staff_note = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Savannah
update profiles set personal_email = 'lancenovak2016@gmail.com', tier_level = 'Branch Manager', staff_note = '8/19/2024 // started BM 07/16/2025' where lower(trim(display_name)) = lower(trim('Lance Jonathon Novak')); -- Savannah
update profiles set personal_email = 'kennelleyc@yahoo.com', staff_note = 'part manager' where lower(trim(display_name)) = lower(trim('Chris Kennelley')); -- Savannah
update profiles set personal_email = 'Lashamus.dowell@usinhomeservices.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Lashamus Dowell')); -- St. Louis
update profiles set personal_email = 'Nicholsderious@gmail.com', tier_level = 'Branch Manager' where lower(trim(display_name)) = lower(trim('Derious Nichols')); -- St. Louis
update profiles set personal_email = 'Jacobrhodes2018@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Jacob Rhodes')); -- St. Louis
update profiles set personal_email = 'Crystaldziedzic@icloud.com' where lower(trim(display_name)) = lower(trim('Crystal Dziedzic')); -- St. Louis
update profiles set personal_email = 'FREEBRUCE314@GMAIL.COM', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('ROY REED')); -- St. Louis
update profiles set personal_email = 'CALEBBROWN3609@GMAIL.COM', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('CALEB BROWN')); -- St. Louis
update profiles set personal_email = 'TYRELL.4FOSTER@ICLOUD.COM', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('TYRELL FOSTER')); -- St. Louis
update profiles set personal_email = 'LOVEJAMESE@GMAIL.COM', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('JAMESE LOVE')); -- St. Louis
update profiles set tier_level = 'Technical Manager' where lower(trim(display_name)) = lower(trim('Darius Green')); -- St. Louis
update profiles set personal_email = 'Dhughes87jobs@gmail.com', staff_note = 'last week of training' where lower(trim(display_name)) = lower(trim('Daryl Hughes')); -- St. Louis
update profiles set personal_email = 'jonathonallen89@gmail.com', tier_level = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('dannyn thornton')); -- Tallahassee
update profiles set personal_email = 'mmccrary70@gmail.com', tier_level = 'Branch Manager', work_phone = '251-654-9423' where lower(trim(display_name)) = lower(trim('Matthew James McCrary')); -- Tallahassee
update profiles set personal_email = 'kristagriffiss@outlook.com', tier_level = 'Parts', work_phone = 'n/a' where lower(trim(display_name)) = lower(trim('Krista Griffiss-Gonatos')); -- Tallahassee
update profiles set personal_email = 'matt_simmons@rocketmail.com.', tier_level = 'Senior Branch Manager', work_phone = '7065704836', staff_note = 'Senior Branch Manager' where lower(trim(display_name)) = lower(trim('Matt Simmons')); -- Wilmington
update profiles set personal_email = 'brbut429@gmail.com', tier_level = 'Branch Manager', work_phone = '---' where lower(trim(display_name)) = lower(trim('Brye''Shawn Butler')); -- Wilmington
update profiles set personal_email = 'justin2801alvarez@gmail.com', tier_level = 'Tier 2', work_phone = '---' where lower(trim(display_name)) = lower(trim('Justin Alvarez')); -- Wilmington
update profiles set personal_email = 'jdavis10705@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Jordan Davis')); -- Wilmington
update profiles set personal_email = 'kalebm182005@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Josh Malloch')); -- Wilmington
update profiles set personal_email = 'sffty9rs@aol.com' where lower(trim(display_name)) = lower(trim('David Lopez')); -- Wilmington
update profiles set personal_email = 'kazz.malik88@gmail.com' where lower(trim(display_name)) = lower(trim('Malik Kaazim-Johnson')); -- Wilmington
update profiles set personal_email = 'Hernandezjavier483@gmail.com', tier_level = 'Tier 3' where lower(trim(display_name)) = lower(trim('Javier Hernandez')); -- Wilmington
update profiles set personal_email = 'mtwhitley@charter.net', tier_level = 'Tier 3', staff_note = 'Quit on 6/3/2026' where lower(trim(display_name)) = lower(trim('Michael Whitley')); -- Wilmington
