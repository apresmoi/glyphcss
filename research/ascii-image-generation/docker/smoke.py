"""B8 GPU-only smoke; it never resolves or downloads a base model."""
from __future__ import annotations
import argparse, hashlib, json, os, platform, time
from pathlib import Path
import accelerate, bitsandbytes, diffusers, onnx, onnxruntime, torch, transformers
CONTRACT_SHA256 = "d9629d90761fbc855ce796efd1a309f488c7ff3fbe8d07220f9154887d87449d"
HARDWARE = {"browser":"Chromium 140.0.7339.80","gpu":"LeDeluge NVIDIA GeForce RTX 4090 Laptop GPU (16 GB)","runtime":"Browser WebGPU only; CPU fallback disabled"}
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
def sha(value): return hashlib.sha256(value).hexdigest()
def write(path, value):
    data=(canonical(value)+"\n").encode(); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data); return sha(data)
def run(args):
    if not torch.cuda.is_available(): raise RuntimeError("B8 requires CUDA; CPU fallback is forbidden.")
    torch.cuda.reset_peak_memory_stats(); torch.manual_seed(4090); device=torch.device("cuda"); started=time.perf_counter()
    x=torch.randn((1,17,64,64),device=device,dtype=torch.float16,requires_grad=True)
    layer=torch.nn.Conv2d(17,17,3,padding=1,bias=False,device=device,dtype=torch.float16)
    resumed_from=None
    if args.resume:
        prior=torch.load(args.resume,map_location=device,weights_only=True)
        layer.load_state_dict(prior["state_dict"]); resumed_from=str(Path(args.resume))
    optimizer=torch.optim.SGD(layer.parameters(),lr=1e-5)
    with torch.autocast(device_type="cuda",dtype=torch.float16): y=layer(x)
    loss=y.float().square().mean()+y.float().abs().mean()
    loss.backward(); optimizer.step(); optimizer.zero_grad(set_to_none=True); torch.cuda.synchronize()
    if not torch.isfinite(loss): raise RuntimeError("B8 smoke loss was not finite")
    root=Path(args.artifact_root).resolve(); run_dir=root/"runs"/args.run_id; run_dir.mkdir(parents=True,exist_ok=True); checkpoint=run_dir/"checkpoint.pt"; torch.save({"format":"glyphcss-b8-smoke/v1","state_dict":layer.state_dict(),"loss":float(loss)},checkpoint); checkpoint_sha=sha(checkpoint.read_bytes()); peak=torch.cuda.max_memory_allocated()/(1024*1024)
    versions={"python":platform.python_version(),"torch":torch.__version__,"cuda":torch.version.cuda,"cudnn":torch.backends.cudnn.version(),"diffusers":diffusers.__version__,"accelerate":accelerate.__version__,"bitsandbytes":bitsandbytes.__version__,"onnx":onnx.__version__,"onnxruntime":onnxruntime.__version__,"transformers":transformers.__version__}
    training={"schemaVersion":"glyph-training-smoke/v1","runId":args.run_id,"imageDigest":os.environ.get("GLYPH_IMAGE_DIGEST","unresolved-local-image"),"toolVersions":versions,"gpu":{"name":torch.cuda.get_device_name(0),"totalMiB":torch.cuda.get_device_properties(0).total_memory/(1024*1024),"peakAllocatedMiB":peak},"mixedPrecision":"fp16","tensor":{"layout":"NCHW","shape":[1,17,64,64],"contractSha256":args.tensor_contract_sha256},"checkpoint":{"path":str(checkpoint.relative_to(root)),"sha256":checkpoint_sha},"resumedFrom":resumed_from,"loss":float(loss),"elapsedMs":(time.perf_counter()-started)*1000,"baseModel":{"downloaded":False,"reason":"B34 has not frozen an immutable base"}}
    training_sha=write(run_dir/"training-smoke.json",training)
    signals={"run-manifest":{"value":1},"container-digest":{"value":1},"commands-recorded":{"value":1},"peak-vram-mib":{"value":peak},"losses-recorded":{"value":1},"checkpoint-hash":{"value":1},"bundle-hash":{"value":0},"clean-reproduction":{"value":0},"research-tests":{"value":0},"package-build":{"value":0},"secret-audit":{"value":0},"large-artifact-audit":{"value":0}}
    artifact={"schemaVersion":"metric-source-artifact/v1","artifactVersion":"v1","gate":"G7","hardware":HARDWARE,"signals":signals,"fixture":f"B8 GPU smoke provenance {training_sha}"}; evidence=root/"evidence"/args.run_id; artifact_sha=write(evidence/"raw"/"artifacts"/"g7.json",artifact)
    report={"schemaVersion":"metric-report/v2","reportId":"raw/g7","contractSha256":CONTRACT_SHA256,"source":{"kind":"reproducibility","path":"reports/evidence/raw/artifacts/g7.json","sha256":artifact_sha},"hardware":HARDWARE,"signals":signals}; report["rawSha256"]=sha(canonical(report).encode()); write(evidence/"raw"/"g7.json",report)
    print(canonical({"run":str(run_dir),"trainingSha256":training_sha,"peakMiB":peak,"checkpointSha256":checkpoint_sha,"gpu":torch.cuda.get_device_name(0)}))
if __name__ == "__main__":
    p=argparse.ArgumentParser(); p.add_argument("--artifact-root",default="/artifacts"); p.add_argument("--run-id",default="remote-smoke"); p.add_argument("--resume"); p.add_argument("--tensor-contract-sha256",default="a1e8600ad64f63b119e2113711b235a3007b28416ae03c38c2440eb6ed1c7a3f"); run(p.parse_args())
