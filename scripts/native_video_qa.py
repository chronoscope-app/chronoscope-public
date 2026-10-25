#!/usr/bin/env python3
"""Record native MCP navigation and inspect every encoded frame (requires PyAV)."""
import argparse
import json
import math
import shutil
import time
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw
from native_mcp import NativeMcp


def frame_metrics(rgb):
    h, w = rgb.shape[:2]
    # A central ground region avoids fixed panels and the navigation rail.
    roi = rgb[int(h*.25):int(h*.78):6, int(w*.40):int(w*.85):6].astype(np.float32)
    return {'mean': float(roi.mean()), 'stddev': float(roi.std()),
            'dark_fraction': float(np.all(roi < 45, axis=2).mean()),
            'white_fraction': float(np.all(roi > 240, axis=2).mean())}, roi


def analyze(path, out, name):
    samples, reduced, thumbnails = [], [], []
    with av.open(str(path)) as video:
        assert len(video.streams.video) == 1 and not video.streams.audio
        stream = video.streams.video[0]
        for index, frame in enumerate(video.decode(stream)):
            rgb = frame.to_ndarray(format='rgb24')
            metrics, roi = frame_metrics(rgb)
            pts = float(frame.pts * frame.time_base)
            samples.append({'index': index, 'seconds': pts, **metrics})
            reduced.append(roi)
            if index % 30 == 0:
                im = Image.fromarray(rgb); im.thumbnail((384, 240))
                thumbnails.append((index, pts, im))
        dimensions = [stream.width, stream.height]
        codec = stream.codec_context.name
    assert len(samples) > 10, 'Too few decoded frames'
    assert all(b['seconds'] > a['seconds'] for a,b in zip(samples,samples[1:])), 'Non-monotonic video timestamps'
    baseline = float(np.median([s['mean'] for s in samples]))
    flashes = []
    for i, sample in enumerate(samples):
        reason = []
        if sample['dark_fraction'] > .85 and sample['mean'] < baseline*.45:
            reason.append('blank-dark-ground')
        if sample['white_fraction'] > .95 and (sample['mean'] > baseline + 45 or (sample['stddev'] < 3 and sample['mean'] > baseline + 8)):
            reason.append('blank-white-ground')
        if 0 < i < len(samples)-1:
            before = float(np.abs(reduced[i]-reduced[i-1]).mean())
            after = float(np.abs(reduced[i]-reduced[i+1]).mean())
            neighbors = float(np.abs(reduced[i-1]-reduced[i+1]).mean())
            if min(before,after) > 25 and neighbors < min(before,after)*.3:
                reason.append('single-frame-discontinuity')
        if reason:
            flashes.append({**sample, 'reasons': reason})
    selected = thumbnails if len(thumbnails) <= 16 else [thumbnails[i] for i in np.linspace(0,len(thumbnails)-1,16,dtype=int)]
    sheet = Image.new('RGB',(4*384,math.ceil(len(selected)/4)*264),'#202020')
    draw = ImageDraw.Draw(sheet)
    for n,(index,pts,im) in enumerate(selected):
        x,y=(n%4)*384,(n//4)*264
        sheet.paste(im,(x,y));draw.text((x+5,y+242),f'frame {index} / {pts:.3f}s',fill='white')
    sheet.save(out/(name+'-contact.jpg'))
    (out/(name+'-frames.json')).write_text(json.dumps(samples,indent=2)+'\n')
    if flashes:
        wanted={f['index']+d for f in flashes for d in [-1,0,1]}
        with av.open(str(path)) as video:
            for i,frame in enumerate(video.decode(video=0)):
                if i in wanted: frame.to_image().save(out/f'{name}-candidate-{i}.png')
    gaps=[b['seconds']-a['seconds'] for a,b in zip(samples,samples[1:])]
    return {'video':str(path),'codec':codec,'decoded_frames':len(samples),'dimensions':dimensions,
            'duration_seconds':samples[-1]['seconds']-samples[0]['seconds'],
            'max_frame_interval_seconds':max(gaps),'median_frame_interval_seconds':float(np.median(gaps)),
            'candidate_flashes':flashes,'contact_sheet':str(out/(name+'-contact.jpg'))}


def negative_control(out, brightness=130):
    name='negative-control' if brightness==130 else 'negative-control-bright'
    path=out/(name+'.mp4')
    with av.open(str(path),'w') as video:
        stream=video.add_stream('libx264',rate=30);stream.width=320;stream.height=240;stream.pix_fmt='yuv420p'
        for i in range(24):
            pixels=np.full((240,320,3),brightness,dtype=np.uint8)
            if i==8: pixels[:]=0
            if i==16: pixels[:]=255
            for packet in stream.encode(av.VideoFrame.from_ndarray(pixels,format='rgb24')): video.mux(packet)
        for packet in stream.encode(): video.mux(packet)
    result=analyze(path,out,name)
    assert {f['index'] for f in result['candidate_flashes']} == {8,16},result
    if brightness==130:
        result['bright_background_control']=negative_control(out,230)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli',required=True,type=Path)
    parser.add_argument('--data-dir',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--manual-seconds',type=float,default=0,help='Additional recorded interval for CUA pointer interaction in each view')
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    profile=args.data_dir.resolve()
    report={'passed':False,'backend':'ScreenCaptureKit app-window H.264 MP4','clips':[],'checks':[]}
    def publish(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    report['negative_control']=negative_control(out);publish()
    client=NativeMcp(args.cli.resolve(),profile,out)
    call=client.call
    try:
        tools=client.rpc('tools/list',{})['tools']
        assert any(t['name']=='chronoscope_view_recording' for t in tools)
        call('demo_open',{'id':'local-wildlife'})
        prefs=call('preferences')
        call('preferences',{'preferences':{**prefs,'basemap':'streets','terrain_builtin':True,'terrain_path':None,'terrain_vertical_datum':'egm96','map_layers':[],'map':{**prefs['map'],'enabled':False}}})
        destination=profile/'agent-files/video-qa';destination.mkdir(exist_ok=True)
        # Automatic stop and repeated stop exercise the watchdog/finalizer.
        auto=destination/f'auto-{time.time_ns()}.mp4'
        call('view_recording',{'action':'start','path':str(auto),'max_seconds':3})
        overlap=client.rpc('tools/call',{'name':'chronoscope_view_recording','arguments':{'action':'start','path':str(destination/'overlap.mp4')}})
        assert overlap.get('isError') and overlap['structuredContent']['error']['code']=='RESOURCE_LIMIT',overlap
        deadline=time.monotonic()+12
        while True:
            state=call('view_recording',{'action':'status','path':str(auto)})
            if state['state'] in ['complete','failed']: break
            assert time.monotonic()<deadline,state
            time.sleep(.3)
        assert state['state']=='complete' and state['bytes']>0,state
        assert call('view_recording',{'action':'stop','path':str(auto)})['state']=='complete'
        again=client.rpc('tools/call',{'name':'chronoscope_view_recording','arguments':{'action':'start','path':str(auto)}})
        assert again.get('isError'), 'Existing video was overwritten'
        report['checks'].append('MCP discovery, automatic stop, repeatable stop and no overwrite')
        for mode in ['map','globe','space-time']:
            call('view_set',{'mode':mode,'fit':True})
            tilt=0 if mode=='map' else 35
            call('view_navigate',{'action':'look_at','center':[-74.195,41.382,180], 'distance_m':26000,'tilt_degrees':tilt})
            deadline=time.monotonic()+60
            while True:
                status=call('view_status')
                if status['mode']==mode and not status['loading']['imagery'] and status['diagnostics']['terrain']['terrainPendingTiles']==0: break
                assert time.monotonic()<deadline,status
                time.sleep(.3)
            path=destination/f'{mode}-{time.time_ns()}.mp4'
            start=call('view_recording',{'action':'start','path':str(path),'fps':60,'max_seconds':60})
            assert start['state']=='recording',start
            print('RECORDING',mode,flush=True)
            trace=[]
            try:
                time.sleep(1)
                steps=[]
                for n in range(24):
                    longitude=-74.195+.018*math.sin(n*math.pi/12)
                    steps += [{'command':'view_navigate','arguments':{'action':'look_at','center':[longitude,41.382+.004*math.sin(n*math.pi/6),180],'distance_m':26000,'tilt_degrees':tilt}},
                              {'command':'wait','arguments':{'milliseconds':80}}]
                for factor in [1.05]*8+[1/1.05]*8:
                    steps += [{'command':'view_navigate','arguments':{'action':'zoom','factor':factor}},
                              {'command':'wait','arguments':{'milliseconds':80}}]
                recipe='Video QA '+mode
                call('view_scenario',{'action':'save','name':recipe,'steps':steps,'overwrite':True})
                run=call('view_scenario',{'action':'run','name':recipe,'timeout_seconds':45})
                deadline=time.monotonic()+50
                while True:
                    run=call('view_scenario',{'action':'status','id':run['id']})
                    if run['state']!='running':break
                    assert time.monotonic()<deadline,run
                    time.sleep(.2)
                assert run['state']=='complete' and run['completed_steps']==80,run
                trace=[{'time':t['unix_ms']/1000,'scene':t['scene'],
                        'diagnostics':{'renderErrorCount':t['render_errors'],'terrain':t['terrain']}}
                       for t in run['trace'] if t['step']%2==1]
                call('view_scenario',{'action':'remove','name':recipe})
                (out/(mode+'-scenario.json')).write_text(json.dumps(run,indent=2)+'\n')
                if args.manual_seconds:
                    print('MANUAL INPUT',mode,flush=True);time.sleep(args.manual_seconds)
                assert call('view_recording',{'action':'status','path':str(path)})['state']=='recording', 'Capture ended before the navigation sequence finished'
                time.sleep(1)
            finally:
                stopped=call('view_recording',{'action':'stop','path':str(path)})
            assert stopped['state']=='complete' and stopped['bytes']>0,stopped
            result=analyze(path,out,mode)
            assert result['codec']=='h264',result
            assert result['dimensions']==[stopped['width'],stopped['height']]
            assert stopped['bytes']==path.stat().st_size, 'Final byte count differs from the MP4'
            assert abs(stopped['duration_seconds']-result['duration_seconds']) < .1, 'Final duration differs from decoded frames'
            assert result['duration_seconds'] >= trace[-1]['time']-trace[0]['time'], 'Video does not cover the movement interval'
            assert result['max_frame_interval_seconds'] < .1, 'Recording gaps could conceal transient flashes'
            assert len({json.dumps(t['scene'],sort_keys=True) for t in trace}) > 10, 'Camera did not move'
            trace_profile=call('view_profile',{'action':'status','id':stopped['profile_id']})
            assert trace_profile['state']=='complete' and trace_profile['samples'],trace_profile
            assert trace_profile['started_unix_ms'] <= stopped['started_unix_ms']+100
            assert all(len(row)==len(trace_profile['columns']) for row in trace_profile['samples'])
            (out/(mode+'-profile.json')).write_text(json.dumps(trace_profile,indent=2)+'\n')
            result['recording']=stopped;result['navigation_samples']=len(trace);result['profile_samples']=len(trace_profile['samples'])
            result['render_errors']=max(t['diagnostics']['renderErrorCount'] for t in trace)
            result['provider_change_counts']=sorted({t['diagnostics']['terrain']['terrainProviderChanges'] for t in trace})
            (out/(mode+'-navigation.json')).write_text(json.dumps(trace,indent=2)+'\n')
            shutil.copy2(path,out/(mode+'.mp4'))
            result['video']=str(out/(mode+'.mp4'))
            report['clips'].append(result);publish()
            assert result['decoded_frames']>120 and not result['candidate_flashes'],result
            assert result['render_errors']==0 and len(result['provider_change_counts'])==1,result
            print('PASS',mode,result['decoded_frames'],'decoded frames, no flash candidates',flush=True)
        # Native file metadata must survive independent diagnostic-history eviction.
        for _ in range(8):
            recent=call('view_profile',{'action':'start','max_seconds':1})
            call('view_profile',{'action':'stop','id':recent['id']})
        expired=call('view_recording',{'action':'status','path':str(path)})
        assert expired['state']=='complete' and expired['profile_available'] is False,expired
        report['checks'].append('Video metadata survives companion profile history eviction')
        report['passed']=True;publish()
        call('view_set',{'mode':'space-time','fit':True})
    finally:
        client.close();publish()
    print(out/'report.json',flush=True)


if __name__=='__main__': main()
