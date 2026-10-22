import csv,datetime,pathlib,json,hashlib
import os
root=pathlib.Path(os.environ['ROOT']); root.mkdir(parents=True,exist_ok=True)
for n,dense in [(20000,False),(100000,False),(100000,True)]:
 p=root/f'accepted-{n}-{ "dense" if dense else "dispersed"}.csv'
 with p.open('w') as f:
  w=csv.writer(f); w.writerow(['timestamp','entity','latitude','longitude','category','value','label','evidence'])
  for i in range(n):
   track=i%20; step=i//20; factor=.015 if dense else 1
   lat=43.1+factor*((step%100)*.008+track*.0001); lon=-79.9+factor*((step//100)*.016+track*.0002)
   t=datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc)+datetime.timedelta(minutes=step)
   w.writerow([t.isoformat(),f'Track {track:02}',format(lat,'.9f'),format(lon,'.9f'),'synthetic-control',i%100,f'Observation {i+1}',f'EVID-{i+1:06}'])
 print(json.dumps({'path':str(p),'rows':n,'tracks':20,'fullTrails':n-20,'dense':dense,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
