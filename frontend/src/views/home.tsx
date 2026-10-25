import { useEffect, useRef } from "react";
import { ArrowRight, Cable, LoaderCircle, Plus, Settings2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Form } from "../components/ui/form";
import { Textarea } from "../components/ui/textarea";
import { viewHierarchy } from "../events/hierarchy";
import type { HomeParameters } from "../presenters/home";

function RoomFormView({ parameters }: { parameters: HomeParameters["form"] }) {
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => { name.current?.focus(); }, [parameters.focusVersion]);
  return <viewHierarchy.Scope name="room-form">
    {emit => <section className="home-form-section" aria-labelledby="room-form-title">
      <h2 id="room-form-title">{parameters.title}</h2>
      <Form intent={{ type: "home.save.requested" }} className="home-form">
        <fieldset disabled={parameters.busy}>
          <label htmlFor="room-name">ルーム名</label>
          <input ref={name} id="room-name" value={parameters.name} required
            onChange={event => emit({ type: "home.form.changed", field: "name", value: event.currentTarget.value })} />
          <label htmlFor="room-mode">配信先</label>
          <select id="room-mode" value={parameters.mode} onChange={event => emit({ type: "home.form.changed", field: "mode", value: event.currentTarget.value })}>
            <option value="client">UDトークへ反映</option><option value="host">独立配信</option>
          </select>
          {parameters.showLink && <>
            <label htmlFor="room-editor-url">{parameters.linkLabel}</label>
            <Textarea id="room-editor-url" value={parameters.editorUrl} required={parameters.linkRequired} rows={3} autoComplete="off" spellCheck={false}
              change={value => ({ type: "home.form.changed", field: "editorUrl", value })}
              keypress={key => ({ type: "home.form.keypressed", ...key })} />
            {parameters.storedLinkHint && <p className="home-hint">{parameters.storedLinkHint}</p>}
          </>}
          {parameters.showInputSource && <>
            <label htmlFor="room-input-source">字幕の入力元</label>
            <select id="room-input-source" value={parameters.inputSource} onChange={event => emit({ type: "home.form.changed", field: "inputSource", value: event.currentTarget.value })}>
              <option value="udtalk">UDトーク</option><option value="microphone">マイク</option>
            </select>
          </>}
          <label htmlFor="room-background">トークの背景</label>
          <Textarea id="room-background" value={parameters.background} rows={4} placeholder="テーマ、登壇者、作品名など"
            change={value => ({ type: "home.form.changed", field: "background", value })}
            keypress={key => ({ type: "home.form.keypressed", ...key })} />
          {parameters.message && <p className="home-error" role="alert">{parameters.message}</p>}
          <div className="home-form-actions">
            <Button type="submit" disabled={parameters.saveDisabled}>{parameters.busy && <LoaderCircle size={16} className="home-loading-icon" aria-hidden="true" />}{parameters.submitLabel}</Button>
            <Button type="button" variant="ghost" intent={{ type: "home.form.cancelled" }}>キャンセル</Button>
          </div>
        </fieldset>
      </Form>
    </section>}
  </viewHierarchy.Scope>;
}

export function HomeView({ parameters }: { parameters: HomeParameters }) {
  return <viewHierarchy.Scope name="home-screen">
    <main className="home-screen">
      <header className="home-header"><h1>Caption Relay</h1>
        <Button disabled={parameters.newDisabled} intent={{ type: "home.new.requested" }}><Plus size={16} aria-hidden="true" />新しいルームに接続</Button>
      </header>
      {parameters.message && <p className="home-error" role="alert">{parameters.message}</p>}
      {parameters.loading && <p className="home-loading" role="status"><LoaderCircle size={16} className="home-loading-icon" aria-hidden="true" />ルームを読み込んでいます</p>}
      {parameters.failed && <Button variant="outline" intent={{ type: "home.retry.requested" }}>再読み込み</Button>}
      {parameters.formOpen && <RoomFormView parameters={parameters.form} />}
      {!parameters.loading && <section className="home-rooms" aria-labelledby="home-rooms-title"><h2 id="home-rooms-title">ルーム</h2>
        <ul>{parameters.rooms.map(room => <li className="home-room" key={room.id}>
          <div className="home-room-info"><h3>{room.name}</h3><div className="home-room-meta"><span><Cable size={14} aria-hidden="true" />{room.connectionLabel}</span>
            {room.active && <span className="home-room-active">使用中</span>}
            {room.lastUsed && <span>最終利用 {room.lastUsed}</span>}
            {room.captionCount > 0 && <span>字幕 {room.captionCount}件</span>}
          </div></div>
          <div className="home-room-actions"><Button variant="ghost" className="home-room-settings" disabled={room.disabled}
            aria-label={room.name + "の接続設定"} title="接続設定" intent={{ type: "home.edit.requested", roomId: room.id }}><Settings2 size={16} /></Button>
            <Button variant="outline" disabled={room.disabled} aria-label={room.name + "に接続"} intent={{ type: "home.connect.requested", roomId: room.id }}>
              {room.connecting ? <LoaderCircle size={16} className="home-loading-icon" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
              {room.connecting ? "接続中…" : "接続"}
            </Button></div>
        </li>)}</ul>
      </section>}
    </main>
  </viewHierarchy.Scope>;
}
