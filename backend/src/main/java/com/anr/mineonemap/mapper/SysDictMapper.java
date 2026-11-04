package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.SysDictItem;
import com.anr.mineonemap.domain.SysDictType;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface SysDictMapper {

    @Select("SELECT * FROM sys_dict_type ORDER BY code")
    List<SysDictType> listTypes();

    @Select("""
            SELECT * FROM sys_dict_item
            WHERE type_code = #{typeCode}
            ORDER BY sort_no, id
            """)
    List<SysDictItem> listItemsByType(String typeCode);

    @Insert("""
            INSERT INTO sys_dict_item (type_code, item_code, label, sort_no, enabled)
            VALUES (#{typeCode}, #{itemCode}, #{label}, #{sortNo}, #{enabled})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insertItem(SysDictItem item);

    @Update("""
            UPDATE sys_dict_item SET label = #{label}, sort_no = #{sortNo}, enabled = #{enabled}
            WHERE id = #{id}
            """)
    int updateItem(SysDictItem item);

    @Delete("DELETE FROM sys_dict_item WHERE id = #{id}")
    int deleteItem(Long id);

    @Select("SELECT * FROM sys_dict_item WHERE id = #{id}")
    SysDictItem findItemById(Long id);
}
