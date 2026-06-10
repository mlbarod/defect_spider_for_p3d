def split_P3D_P4D(dataframe):    
    cond_35 = (
        pl.element()
        .str.extract_all(r"\d+")
        .list.eval(pl.element().str.starts_with("35"))
        .list.any()
    )   
    
    dataframe_P4D = (
        dataframe.with_columns(
            pl.col("eqpid").list.eval(
                pl.when(cond_35)
                .then(pl.element())
                .otherwise(None)
            ).list.drop_nulls()
        )
        .filter(pl.col("eqpid").list.len() > 0)
    )    
    
    dataframe_P3D = dataframe.with_columns(
        pl.col("eqpid").list.eval(
            pl.when(cond_35)
            .then(None)
            .otherwise(pl.element())
        ).list.drop_nulls()
    )
    return dataframe_P3D, dataframe_P4D


def split_drawing_list_P3D_P4D(dataframe):
    filtered_dataframe_P3D = dataframe.filter(
        ~pl.col("eqp_ch")
          .str.extract_all(r"\d+")
          .list.eval(pl.element().str.starts_with("35"))
          .list.any()
    )

    filtered_dataframe_P4D = dataframe.filter(
        pl.col("eqp_ch")
          .str.extract_all(r"\d+")
          .list.eval(pl.element().str.starts_with("35"))
          .list.any()
    )
    
    return filtered_dataframe_P3D, filtered_dataframe_P4D


def split_drawing_list_for_main_P3D_P4D(dataframe):
    filtered_dataframe_P3D = dataframe.filter(
        ~pl.col("eqp_id")
          .str.extract_all(r"\d+")
          .list.eval(pl.element().str.starts_with("35"))
          .list.any()
    )

    filtered_dataframe_P4D = dataframe.filter(
        pl.col("eqp_id")
          .str.extract_all(r"\d+")
          .list.eval(pl.element().str.starts_with("35"))
          .list.any()
    )
    
    return filtered_dataframe_P3D, filtered_dataframe_P4D


line_name = 'P3D (D1c)_EQP MAIN'
select_line, device = 'PFB3'. 'D1c'


folder_path = f'/appdata/hadoop/code/eads/{select_line}/{device}'
spec_table = pd.read_parquet(f'/appdata/hadoop/code/eads/{select_line}/{device}_measure_spec.parquet')
spec_table['ver'] = spec_table['step_seq'].str.extract(r'^([a-zA-Z]+)')

if line_name == line_name:
    filtered_df_final_list = pl.read_parquet(folder_path + '/main_fail_list.parquet')
    filtered_df_final_list_std = pl.read_parquet(folder_path + '/main_fail_list_std.parquet')
else:
    filtered_df_final_list = pl.read_parquet(folder_path + '/fail_list.parquet')
    filtered_df_final_list_std = pl.read_parquet(folder_path + '/fail_list_std.parquet')



if (select_line == 'PFB3' and device == 'D1c') or select_line == 'P4D':
    filtered_df_final_list_P3D, filtered_df_final_list_P4D = split_P3D_P4D(filtered_df_final_list)
    filtered_df_final_list_std_P3D, filtered_df_final_list_std_P4D = split_P3D_P4D(filtered_df_final_list_std)
    if select_line == 'PFB3': 
        filtered_df_final_list = filtered_df_final_list_P3D
        filtered_df_final_list_std = filtered_df_final_list_std_P3D
    elif select_line == 'P4D': 
        filtered_df_final_list = filtered_df_final_list_P4D
        filtered_df_final_list_std = filtered_df_final_list_std_P4D



total_ppid = len(filtered_df_final_list)
ppid_cnt = sum(1 for s in filtered_df_final_list['eqpid'] if len(s) != 0) + sum(1 for s in filtered_df_final_list_std['eqpid'] if len(s) != 0)
eqp_cnt = sum(len(s) for s in filtered_df_final_list['eqpid']) + sum(len(s) for s in filtered_df_final_list_std['eqpid'])


col1, col2, col3, col4 = st.columns(4)
col1.metric("감지 라인",value=line_name)
col2.metric("모니터링 STEP 총합", value=total_ppid)
col3.metric("감지 STEP 갯수", value=ppid_cnt)
col4.metric("감지 Chamber 갯수", value=eqp_cnt)
# col5.metric("",value="")  


with open(f'/appdata/hadoop/code/eads/{select_line}/met.txt', "r", encoding="utf-8") as file:
    lines = file.readlines()

df_list = pd.DataFrame(lines, columns=["col"])

df_split = df_list['col'].str.split('\t', expand=True)
df_split.columns = [f'col1_part{i+1}' for i in range(df_split.shape[1])]
df_list = pd.concat([df_list, df_split], axis=1).drop(columns=['col'])
df_list = df_list.applymap(lambda x: x.strip() if isinstance(x, str) else x)
df_list.columns = df_list.iloc[0]
df_list = df_list[1:].reset_index(drop=True)
df_list[['main_step', 'met_step']] = df_list[['main_step', 'met_step']].replace(r'.*%', '', regex=True)
df_list = df_list.loc[:, df_list.columns.notnull()]
df_list = df_list[df_list['device'] == device]


draw_step_new = filtered_df_final_list.with_columns(
    pl.col("eqpid").list.len().alias("eqpid")
)
draw_step_new = draw_step_new.select(['main_seq','met_seq','eqpid']).rename({"main_seq": "대상스탭", "met_seq":"계측스탭", "eqpid": "중심치 이상건수"})
draw_step_new = draw_step_new.to_pandas()



draw_step_new_final = []

# table_1의 각 A에 대해 table_2.D가 포함되는지 확인
for val in draw_step_new["대상스탭"]:
    matched = df_list[df_list["main_step"].apply(lambda main_step: main_step in val)]
    if not matched.empty:
        draw_step_new_final.append(matched["step_desc"].values[0])
    else:
        draw_step_new_final.append(None)

# table_1에 새로운 컬럼으로 추가
draw_step_new["step_desc"] = draw_step_new_final
draw_step_new = draw_step_new[['대상스탭','계측스탭','step_desc','중심치 이상건수']]
draw_step_new = draw_step_new.sort_values(by='대상스탭', ascending=True)


draw_step_new_std = filtered_df_final_list_std.with_columns(
    pl.col("eqpid").list.len().alias("eqpid")
)
draw_step_new_std = draw_step_new_std.select(['main_seq', 'met_seq','eqpid']).rename({"main_seq": "대상스탭", "met_seq":"계측스탭","eqpid": "산포 이상건수"})
draw_step_new_std = draw_step_new_std.to_pandas()

draw_step_new_final_std = []

# table_1의 각 A에 대해 table_2.D가 포함되는지 확인
for val in draw_step_new_std["대상스탭"]:
    matched = df_list[df_list["main_step"].apply(lambda main_step: main_step in val)]
    if not matched.empty:
        draw_step_new_final_std.append(matched["step_desc"].values[0])
    else:
        draw_step_new_final_std.append(None)

# table_1에 새로운 컬럼으로 추가
draw_step_new_std["step_desc"] = draw_step_new_final_std
draw_step_new_std = draw_step_new_std[['대상스탭','계측스탭','step_desc','산포 이상건수']]
draw_step_new_std = draw_step_new_std.sort_values(by='대상스탭', ascending=True)    


# select_step = st.segmented_control('이상건수', draw_step)


try:

    draw_step_new = draw_step_new.merge(
                    df_list[['step_desc','sdwt']], left_on='step_desc', right_on='step_desc', how='inner')

    draw_step_new_std = draw_step_new_std.merge(
                    df_list[['step_desc','sdwt']], left_on='step_desc', right_on='step_desc', how='inner')

    draw_step_new = draw_step_new.drop_duplicates()
    draw_step_new_std = draw_step_new_std.drop_duplicates()
    

    draw_step_new_final = draw_step_new[
    ['대상스탭', '계측스탭', 'step_desc', '중심치 이상건수', 'sdwt']].merge(
    draw_step_new_std[['대상스탭', '계측스탭', '산포 이상건수', 'sdwt']], 
    left_on=['대상스탭','계측스탭'], 
    right_on=['대상스탭','계측스탭'], 
    how='outer', 
    suffixes=('_new', '_std'))


    draw_step_new_final['sdwt'] = draw_step_new_final['sdwt_new'].combine_first(draw_step_new_final['sdwt_std'])
    
    # 불필요한 sd 컬럼 제거하고 최종 정리
    draw_step_new_final = draw_step_new_final.drop(columns=['sdwt_new', 'sdwt_std'])
    draw_step_new_final.fillna(0, inplace=True)
    draw_step_new_final = draw_step_new_final.drop_duplicates()
    

    sdwt_list = draw_step_new_final['sdwt'].unique().tolist()

    # ----sdwt별로 list화-----------
    def clean_and_dedup(items):
        seen = set()
        result = []
    
        for element in items:
            # \xa0 를 공백으로 변환
            cleaned = element.replace('\xa0', ' ')
            # 공백을 기준으로 개별 토큰으로 분리
            for token in cleaned.split():
                if token not in seen:
                    seen.add(token)
                    result.append(token)
        return result
    # ------------------------------
    
    sdwt_list = clean_and_dedup(sdwt_list)
    
    sdwt_list.insert(0,'ALL')
    sdwt_selection = st.segmented_control('SDWT선택', sdwt_list, default = 'ALL')

    if sdwt_selection != 'ALL':
        draw_step_new_final = draw_step_new_final[draw_step_new_final['sdwt'].str.contains(sdwt_selection)]  
    
    # Grid 옵션 구성
    draw_step_new_final_list = draw_step_new_final[(draw_step_new_final['중심치 이상건수'] != 0) | (draw_step_new_final['산포 이상건수'] != 0)]
    num_series, txt_series = draw_step_new_final_list['계측스탭'].str.extract(r'^(\d{6})_(.+)$').astype(str).T.values
    draw_step_new_final_list['계측스탭'] = num_series          # A 컬럼을 6자리 숫자로 교체
    draw_step_new_final_list.insert(draw_step_new_final_list.columns.get_loc('계측스탭') + 1, '계측항목', txt_series)   

    gb = GridOptionsBuilder.from_dataframe(draw_step_new_final_list)
    gb.configure_selection('single')  # 단일 행 선택
    grid_options = gb.build()

# AgGrid 렌더링
    grid_response = AgGrid(
        draw_step_new_final_list,
        gridOptions=grid_options,
        update_mode=GridUpdateMode.SELECTION_CHANGED,
        height=400,
        fit_columns_on_grid_load=True
    )
    
    result = grid_response['selected_rows']
    select_step = result['대상스탭'][0]
    if line_name == line_name:
        select_met_step = f"{result['계측스탭'][0]}_{result['계측항목'][0]}_main"
    else:
        select_met_step = f"{result['계측스탭'][0]}_{result['계측항목'][0]}"
    select_met_step_spec = select_met_step.split('_')[0]   

    if select_step:
                   
        if line_name == line_name:
            if result['중심치 이상건수'][0] != 0:

                subfolders_date = [name for name in os.listdir(f'{folder_path}/{select_step}/{select_met_step}') if os.path.isdir(os.path.join(f'{folder_path}/{select_step}/{select_met_step}', name))][-1]
                select_spec_step = spec_table[spec_table['step_seq'].str.contains(select_met_step_spec)]
                spec_ver_list = set(select_spec_step['ver'])

                if st.session_state.last_filter != f'{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/{select_step}':
                    st.session_state.last_filter = f'{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/{select_step}'
    
    
                # ---------- 파일 존재 여부 ----------
                if os.path.isfile(
                    os.path.join(f'{folder_path}/{select_step}/{select_met_step}/{subfolders_date}',
                                 f'main_fail_{select_step}.parquet')
                ):
                    # ---------- parquet 로드 (Polars) ----------
                    if line_name == line_name:
                        df_final_list = pl.read_parquet(
                            f"{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/main_all_{select_step}.parquet"
                        )
                        img_drawing_list = pl.read_parquet(
                            f'{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/main_fail_{select_step}.parquet'
                        )
                    else:
                        df_final_list = pl.read_parquet(
                        f"{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/all_{select_step}.parquet"
                    )
                        img_drawing_list = pl.read_parquet(
                        f'{folder_path}/{select_step}/{select_met_step}/{subfolders_date}/fail_{select_step}.parquet'
                    )

                    if (select_line == 'PFB3' and device == 'D1c') or select_line == 'P4D':
                        df_final_list_P3D, df_final_list_P4D = split_drawing_list_for_main_P3D_P4D(df_final_list)
                        img_drawing_list_P3D, img_drawing_list_P4D  = split_drawing_list_for_main_P3D_P4D(img_drawing_list)
                        if select_line == 'PFB3': 
                            df_final_list = df_final_list_P3D
                            img_drawing_list = img_drawing_list_P3D
                        elif select_line == 'P4D': 
                            df_final_list = df_final_list_P4D
                            img_drawing_list = img_drawing_list_P4D

                
                    # ---------- 1️⃣ 시간 순 정렬 ----------
                    df_final_list = df_final_list.sort('tkout_time')
                    img_drawing_list = img_drawing_list.sort('tkout_time')
                
                    # ---------- 각 eqp 별 루프 ----------
                    eqp_list = sorted(img_drawing_list['eqp_id'].unique())
                    for i, eqp in enumerate(eqp_list):

                        fig = go.Figure()
                
                        # ----- change_point 로드 & asset 정규화 -----
                        change_point = pl.read_parquet('/appdata/abnormal_trend/pic/pm_code_info.parquet')
                        change_point = change_point.with_columns(
                            pl.col('asset').str.replace_all('-', '_').alias('asset')
                        )
                        asset_match = change_point.filter(pl.col('asset').str.contains(eqp, literal=True)
                                                         )
                
                        # ----- asset_match -> pandas, datetime 변환 -----
                        asset_match_pd = asset_match.select(['inprg_dt', 'work_type']).to_pandas()
                        if asset_match_pd['inprg_dt'].dtype == object:
                            asset_match_pd['inprg_dt'] = pd.to_datetime(asset_match_pd['inprg_dt'])
                
                        # ----- df_final_list 구간에 맞춰 asset_match 필터링 -----
                        tkout_min = pd.to_datetime(df_final_list['tkout_time'].min())
                        tkout_max = pd.to_datetime(df_final_list['tkout_time'].max())
                        asset_match_pd = asset_match_pd[
                            (asset_match_pd['inprg_dt'] >= tkout_min) &
                            (asset_match_pd['inprg_dt'] <= tkout_max)
                        ].reset_index(drop=True)
                
                        # ---------- 2️⃣ 전체 설비 trace ----------
                        df_final_list_pd = df_final_list.to_pandas()
                        hover_texts_all = df_final_list_pd.apply(
                            lambda row: f"lot_wf: {row['lot_wf']}<br>"
                                        f"tkout_time: {row['tkout_time']}<br>"
                                        f"ver: {row['step_seq'][0:2]}",
                            axis=1
                        )
   
    
                        process_ids = df_final_list['process_id'].unique().to_list()
                        palette = px.colors.qualitative.Bold
                        color_map = {pid: palette[i % len(palette)] for i, pid in enumerate(process_ids)}
                        
                        for pid in process_ids:
                            sub_df = df_final_list.filter(pl.col('process_id') == pid)
                            sub_pd = sub_df.to_pandas()
                            hover_text = sub_pd.apply(
                                lambda r: f"lot_wf: {r['lot_wf']}<br>"
                                          f"tkout_time: {r['tkout_time']}<br>"
                                          f"ver: {r['step_seq'][0:2]}<br>"
                                          f"eqp_ch: {r['eqp_ch']}",
                                axis=1,
                            )
                            fig.add_trace(
                                go.Scatter(
                                    x=sub_df['tkout_time'],
                                    y=sub_df['fab_value'],
                                    mode='markers',
                                    marker=dict(color=color_map[pid], size=7, opacity=0.1),
                                    hovertext=hover_text,
                                    hoverinfo='text',
                                    name=str(pid)                 # ← 레전드 라벨
                                )
                            )
                                                    # ---------- 3️⃣ eqp‑별 색상 trace ----------
                        img_drawing_list_for_colors = (
                            img_drawing_list.filter(pl.col('eqp_id') == eqp)
                                              .sort('tkout_time')        # <‑ 반드시 정렬
                        )
                        colors = img_drawing_list_for_colors.with_columns(
                            pl.when(pl.col('final_decision') == 'OK')
                              .then(pl.lit('blue'))
                              .otherwise(pl.lit('red'))
                              .alias('color')
                        )
                        df_color_pd = img_drawing_list_for_colors.to_pandas()
                        hover_texts = df_color_pd.apply(
                            lambda row: f"lot_wf: {row['lot_wf']}<br>"
                                        f"tkout_time: {row['tkout_time']}<br>"
                                        f"eqpch: {row['eqp_ch']}<br>"
                                        f"ver: {row['step_seq'][0:2]}",
                            axis=1
                        )
                        fig.add_trace(
                            go.Scatter(
                                x=img_drawing_list_for_colors['tkout_time'],
                                y=img_drawing_list_for_colors['fab_value'],
                                mode='markers',
                                marker=dict(color=colors['color'].to_list(), size=8),
                                hovertext=hover_texts,
                                hoverinfo='text',
                                name=f'{eqp}'
                            )
                        )
                
                        # ---------- 4️⃣ outlier 제거 ----------
                        def remove_outliers(df: pl.DataFrame, column: str) -> pl.DataFrame:
                            Q1 = df[column].quantile(0.2)
                            Q3 = df[column].quantile(0.8)
                            IQR = Q3 - Q1
                            lower = Q1 - 1.5 * IQR
                            upper = Q3 + 1.5 * IQR
                            return df.filter((df[column] >= lower) & (df[column] <= upper))
                
                        df_clean = remove_outliers(df_final_list, 'fab_value')
                
                        # ---------- 5️⃣ y‑range 계산 ----------
                        def safe_range(series):
                            return series.min() - 2, series.max() * 1.3
                
                        y_range_df_clean = safe_range(df_clean['fab_value'])
                        y_min, y_max = y_range_df_clean
                
                        # ---------- 6️⃣ asset_match_pd 로 세로 실선 + 라벨 ----------
                        vertical_shapes = []
                        for _, row in asset_match_pd.iterrows():
                            dt, label = row['inprg_dt'], row['work_type']
                            vertical_shapes.append(dict(
                                type="line",
                                x0=dt, x1=dt,
                                y0=y_min, y1=y_max,
                                line=dict(color="green", width=1, dash="dot")
                            ))
                            fig.add_annotation(
                                x=dt, y=y_max, text=label,
                                showarrow=False, xanchor="left", yanchor="auto",
                                font=dict(color="green", size=12),
                                bgcolor="rgba(255,255,255,0.7)"
                            )
    
                        # 처음부터 레이아웃에 세로선 삽입
                        fig.update_layout(shapes=vertical_shapes)
                
                        # ---------- 7️⃣ dropdown / 버튼 (기존 코드 그대로) ----------
                                    # dropdown 버튼 항목 생성
                        threshold_buttons = [
                            dict(
                                label=f"SPEC표시 : {val}기준",
                                method="relayout",
                                args=[{
                                    "shapes": vertical_shapes + [
                                        dict(
                                            type="line",
                                            x0=df_final_list['tkout_time'].min(),
                                            x1=df_final_list['tkout_time'].max(),
                                            y0=select_spec_step[select_spec_step['ver'] == val]['spec_high'].values[0],
                                            y1=select_spec_step[select_spec_step['ver'] == val]['spec_high'].values[0],
                                            line=dict(color="red", width=2, dash="dash")
                                            )
                                        ]
                                    }]
                                )
                            for val in spec_ver_list
                        ]
                        
                        
                        # '기준선 없음' 항목 추가
                        threshold_buttons.insert(0, dict(
                            label="SPEC 미표시",
                            method="relayout",
                            args=[{"shapes": vertical_shapes}]
                        ))
                        
                        # layout에 updatemenus 추가
                        fig.update_layout(
                            yaxis=dict(range=list(y_range_df_clean)),
                            title=dict(
                            # ② HTML <b> 태그로 굵게 (Plotly는 기본적으로 HTML을 렌더링함)
                            text=f"<b>{result['step_desc'][0]}/계측스탭:{select_met_step}/{eqp}/ 밑둥 이상</b>"),
                            # title=result['step_desc'][0] + f'/계측스탭:{select_met_step} /{eqp}/ 밑둥 이상',
                        
                            updatemenus=[
                                # ✅ 일반 버튼 그룹
                                dict(
                                    type="buttons",
                                    direction="right",
                                    x=0.5,
                                    y=1.15,
                                    showactive=True,
                                    buttons=[
                                        dict(
                                            label="Y축: Scale조정",
                                            method="relayout",
                                            args=[{
                                                "yaxis.range": [df_clean['fab_value'].min()-2, df_clean['fab_value'].max()*1.3]
                                            }]
                                        ),
                                        dict(
                                            label="Y축: Scale미조정",
                                            method="relayout",
                                            args=[{
                                                "yaxis.range": [df_final_list['fab_value'].min()-3, df_final_list['fab_value'].max()+1]
                                            }]
                                        )
                                    ]
                                ),
                        
                                # ✅ 기준선 선택용 드롭다운 메뉴
                                dict(
                                    type="dropdown",
                                    direction="down",
                                    x=0.75,
                                    y=1.15,
                                    showactive=True,
                                    buttons=threshold_buttons
                                )
                            ]
                        )
                
                        # ---------- 8️⃣ FigureResampler 사용 ----------
                        resampled_fig = FigureResampler(fig)