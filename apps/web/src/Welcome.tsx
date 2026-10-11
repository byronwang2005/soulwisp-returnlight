export function Welcome({onAuth,onTutorial}:{onAuth:()=>void;onTutorial:()=>void}) {
  return <section className="welcome returnlight-hero" aria-labelledby="welcome-title">
    <picture className="hero-art" aria-hidden="true">
      <source media="(max-width: 700px)" srcSet="/brand/returnlight-city-small.webp"/>
      <img src="/brand/returnlight-city.webp" alt="" width={1672} height={941} fetchPriority="high"/>
    </picture>
    <div className="hero-atmosphere" aria-hidden="true"/>
    <div className="hero-content scroll-region">
      <div className="hero-edition"><span>暮钟城 · 终夜未尽</span><span>SOULWISP: RETURNLIGHT</span></div>
      <div className="hero-identity">
        <h1 id="welcome-title" aria-label="亡絮：归灯">
          <button type="button" className="hero-interaction hero-brand-entry" onClick={onAuth} aria-label="踏入余灯集市">
            <img className="hero-mark" src="/brand/returnlight-mark.png" width={512} height={512} alt=""/>
            <span className="hero-wordmark"><span>亡絮</span><i aria-hidden="true">·</i><span>归灯</span></span>
          </button>
        </h1>
        <p className="hero-english" lang="en">SOULWISP <span>/</span> RETURNLIGHT</p>
        <p className="hero-story"><button type="button" className="hero-interaction hero-story-entry" onClick={onTutorial} aria-label="先体验归灯训练">灯火之下，谁与你同行。</button></p>
        <p className="hero-description">搜寻旧城遗物，拼合行动的证据。<br/>在月蚀抵达之前，护送最后一缕光。</p>
      </div>
      <div className="hero-bottom">
        <p className="hero-note">4–10 人<span aria-hidden="true"> / </span>实时探索与社会推理</p>
        <p className="hero-location">余灯集市 / THE LAST MARKET</p>
      </div>
    </div>
  </section>;
}
